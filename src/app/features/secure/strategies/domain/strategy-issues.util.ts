import {
  collectExecutableStrategyRulesIssues,
  collectStrategyRulesIssues,
  isCatalogDependentIssue,
  type StrategyRules,
  type StrategyValidationIssue,
} from '@syldel/trading-shared-types';
import { isPathInside, parentPath, toLocalIssuePath } from './strategy-path.util';
import { getAtPath, isLogicalGroup } from './strategy-tree.ops';

/**
 * ============================================================================
 * 🚦 STRATEGY ISSUES
 * Décide, pour chaque anomalie remontée par la validation locale, si ce build
 * a le droit d'en faire un verdict — ou s'il doit la laisser à
 * `POST /exchanges/strategies/validate`.
 *
 * Le paquet partagé traite déjà un axe de dérive : client ↔ serveur, via
 * `CATALOG_DEPENDENT_ISSUE_CODES`. Un nom d'indicateur ou un `kind` de
 * transform inconnu localement peut simplement être plus récent côté bot ; le
 * client ne tranche pas.
 *
 * Il reste un second axe, que cette partition-là ne couvre pas : **document ↔
 * client**. Une stratégie écrite par un build plus récent peut contenir un type
 * de nœud ou une valeur d'énumération absente des unions compilées ici. La
 * justification donnée aux codes de structure (« les unions ne peuvent pas
 * diverger entre client et serveur sans rebuild des deux côtés ») est exacte
 * sur son axe, mais ne s'applique pas à un document plus vieux ou plus jeune
 * que le build qui l'ouvre.
 *
 * Appliquée à la lettre, la règle « tout code de structure bloque » rendrait
 * toute stratégie issue d'un build plus récent définitivement inéditable — pas
 * même renommable — ce qui contredit la décision « nœud inconnu = lecture
 * seule + bandeau, jamais bloquant ».
 *
 * D'où la distinction faite ici, sur les seuls codes de structure :
 *
 * - « valeur non reconnue » (`UNKNOWN_NODE_TYPE`, `UNKNOWN_*_OPERATOR`...) —
 *   verdict laissé au serveur **si** l'anomalie tombe hors de ce que ce build a
 *   édité ; c'est très probablement un document plus récent, pas une faute ;
 * - « valeur malformée » (`INVALID_TREND_PERIOD`, `EMPTY_LOGICAL_CONDITIONS`,
 *   `*_TOO_DEEP`, `MISSING_*`...) — toujours bloquant : aucune version future
 *   ne rendra un offset négatif ou une période non entière valides.
 *
 * Une anomalie « valeur non reconnue » **dans** un sous-arbre que l'utilisateur
 * vient d'éditer bloque, elle : ce n'est plus un héritage, c'est un bug d'ici.
 * ============================================================================
 */

/**
 * Codes de structure dont le verdict est « je ne reconnais pas cette valeur »,
 * par opposition à « cette valeur est malformée ». Seuls ceux-là peuvent
 * légitimement venir d'un document écrit par une version plus récente.
 */
export const UNRECOGNISED_VALUE_ISSUE_CODES: ReadonlySet<StrategyValidationIssue['code']> = new Set<
  StrategyValidationIssue['code']
>([
  'UNKNOWN_NODE_TYPE',
  'UNKNOWN_OPERAND_TYPE',
  'UNKNOWN_LOGICAL_OPERATOR',
  'UNKNOWN_COMPARISON_OPERATOR',
  'UNKNOWN_TREND_DIRECTION',
  'UNKNOWN_TREND_MODE',
  'UNKNOWN_ARITH_OPERATOR',
  'UNKNOWN_CROSS_DIRECTION',
  'INVALID_PRICE_FIELD',
]);

export interface StrategyIssuePartition {
  /**
   * Anomalies dont ce build est certain : elles empêchent d'attacher la
   * stratégie à un chart ou de l'envoyer au bot. Jamais d'empêcher un
   * enregistrement dans la bibliothèque — un brouillon reste sauvegardable.
   */
  blocking: StrategyValidationIssue[];
  /**
   * Anomalies laissées au verdict de `POST /exchanges/strategies/validate` :
   * catalogue potentiellement plus récent côté serveur, ou valeur héritée d'un
   * document écrit par une version plus récente de l'app.
   */
  deferred: StrategyValidationIssue[];
}

/**
 * `editedPaths` : les sous-arbres que l'utilisateur a effectivement modifiés
 * dans cette session d'édition (chemins au format strategy-path.util.ts). Une
 * liste vide — cas d'un document simplement ouvert, ou d'une validation faite
 * ailleurs que dans l'éditeur — signifie « rien n'a été édité ici », donc
 * aucune valeur non reconnue n'est imputable à ce build.
 */
export function partitionStrategyIssues(
  issues: readonly StrategyValidationIssue[],
  editedPaths: readonly string[] = [],
): StrategyIssuePartition {
  const blocking: StrategyValidationIssue[] = [];
  const deferred: StrategyValidationIssue[] = [];

  for (const issue of issues) {
    if (isCatalogDependentIssue(issue)) {
      deferred.push(issue);
      continue;
    }

    if (!UNRECOGNISED_VALUE_ISSUE_CODES.has(issue.code)) {
      blocking.push(issue);
      continue;
    }

    const authoredHere = editedPaths.some((edited) => isPathInside(issue.path, edited));
    (authoredHere ? blocking : deferred).push(issue);
  }

  return { blocking, deferred };
}

/** Validation locale complète d'un arbre, déjà partitionnée. */
export function collectEditorIssues(
  rules: StrategyRules | undefined | null,
  editedPaths: readonly string[] = [],
): StrategyIssuePartition {
  return partitionStrategyIssues(collectStrategyRulesIssues(rules), editedPaths);
}

/**
 * `true` si `path` contient (ou est) un nœud que ce build ne sait pas
 * interpréter — donc à rendre en lecture seule plutôt qu'à éditer.
 */
export function hasUnsupportedNodeAt(
  path: string,
  issues: readonly StrategyValidationIssue[],
): boolean {
  return issues.some(
    (issue) => UNRECOGNISED_VALUE_ISSUE_CODES.has(issue.code) && isPathInside(issue.path, path),
  );
}

/**
 * `true` si la stratégie peut être envoyée telle quelle à `POST /analysis`.
 *
 * Sert de garde-fou avant l'appel : le backtest **rejette** une stratégie sans
 * `long` ni `short` (`collectExecutableStrategyRulesIssues`), et ce rejet ferait
 * échouer toute la requête d'analyse — y compris les indicateurs qui n'ont rien
 * à voir. Mieux vaut ne pas la joindre que de perdre le chart entier.
 *
 * Aucun `editedPaths` n'est transmis : hors de l'éditeur, rien n'a été écrit
 * par ce build, donc une valeur non reconnue vient d'un document plus récent et
 * doit partir au verdict du serveur plutôt que d'être bloquée ici.
 */
export function isLocallyExecutable(rules: StrategyRules | undefined | null): boolean {
  return partitionStrategyIssues(collectExecutableStrategyRulesIssues(rules)).blocking.length === 0;
}

/**
 * Où se trouve, dans l'arbre, le nœud qu'une anomalie désigne.
 *
 * Deux chemins et non un seul, parce que l'éditeur en a besoin de deux : le
 * **groupe** est ce qu'il sait ouvrir (la vue focalisée rend un sous-arbre,
 * pas un opérande isolé), la **ligne** est ce qu'il sait marquer.
 */
export interface IssueLocation {
  /** Groupe logique à ouvrir pour montrer l'anomalie dans son contexte. */
  groupPath: string;
  /** Ligne à signaler — le groupe lui-même si l'anomalie le vise directement. */
  nodePath: string;
}

/**
 * Situe une anomalie dans l'arbre, ou `null` si elle n'y est pas adressable.
 *
 * Une anomalie désigne souvent un **opérande** (`…conditions[0].left`), que
 * l'arbre ne sait pas rendre seul : on remonte donc jusqu'au premier groupe
 * logique, et la ligne à marquer est le dernier nœud traversé avant lui. Un
 * chemin devenu invalide entre-temps — l'utilisateur a supprimé la condition
 * depuis le verdict — rend `null` plutôt que de désigner un voisin au hasard.
 */
export function locateIssue(
  rules: StrategyRules | undefined | null,
  issuePath: unknown,
): IssueLocation | null {
  const local = toLocalIssuePath(issuePath);
  if (!rules || !local) return null;

  let nodePath = local;
  let current: string | null = local;

  while (current) {
    const value = getAtPath(rules, current);

    // Rien à cette adresse : le chemin ne correspond plus à l'arbre courant.
    if (value === undefined) return null;
    if (isLogicalGroup(value)) return { groupPath: current, nodePath };

    // `conditions` est un tableau, pas un nœud : le traverser sans le retenir,
    // sinon la ligne signalée serait la liste entière plutôt que la condition.
    if (!Array.isArray(value)) nodePath = current;
    current = parentPath(current);
  }

  return null;
}
