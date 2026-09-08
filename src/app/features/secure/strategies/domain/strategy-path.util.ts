/**
 * ============================================================================
 * 🧭 STRATEGY PATH
 * Adressage d'un nœud ou d'un opérande à l'intérieur d'un `StrategyRules`,
 * sous exactement la même forme que les chemins produits par
 * `collectStrategyRulesIssues` (@syldel/trading-shared-types) :
 * `rules.long.entry.conditions[0].left`.
 *
 * Vocabulaire unique et délibéré : une anomalie de validation et une opération
 * d'édition désignent le même sous-arbre avec la même chaîne, sans traduction
 * intermédiaire. C'est ce qui rend possible le blocage « adressé par chemin »
 * (voir strategy-issues.util.ts) — savoir si une anomalie tombe dans un
 * sous-arbre que ce build vient d'éditer, ou dans un sous-arbre hérité d'un
 * document écrit par une version plus récente.
 * ============================================================================
 */

/** Un segment de chemin : une clé d'objet, ou un index de tableau. */
export type StrategyPathSegment = string | number;

/** Premier segment de tout chemin, imposé par `collectStrategyRulesIssues`. */
export const STRATEGY_PATH_ROOT = 'rules';

/** Forme complète acceptée : `nom`, `nom[0]`, `nom.autre`, `nom[0][1].autre`. */
const PATH_RE = /^[A-Za-z_$][\w$]*(\[\d+\])*(\.[A-Za-z_$][\w$]*(\[\d+\])*)*$/;
const SEGMENT_RE = /([A-Za-z_$][\w$]*)|\[(\d+)\]/g;

/**
 * Découpe un chemin en segments, ou `null` s'il est malformé.
 *
 * Ne lève jamais : ces chemins viennent d'une réponse serveur ou d'un document
 * stocké, donc de données non typées — un chemin illisible doit être ignoré,
 * pas faire tomber l'éditeur.
 */
export function parseStrategyPath(path: string): StrategyPathSegment[] | null {
  if (typeof path !== 'string' || !PATH_RE.test(path)) return null;

  const segments: StrategyPathSegment[] = [];
  for (const match of path.matchAll(SEGMENT_RE)) {
    segments.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  return segments;
}

/** Réciproque de `parseStrategyPath`. */
export function formatStrategyPath(segments: readonly StrategyPathSegment[]): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${segment}` : segment;
  }, '');
}

/** Chemin d'un enfant direct : `childPath('rules.long', 'entry')` → `rules.long.entry`. */
export function childPath(path: string, segment: StrategyPathSegment): string {
  return typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`;
}

/** Chemin du parent, ou `null` à la racine (et sur un chemin malformé). */
export function parentPath(path: string): string | null {
  const segments = parseStrategyPath(path);
  if (!segments || segments.length <= 1) return null;
  return formatStrategyPath(segments.slice(0, -1));
}

/**
 * `true` si `candidate` désigne `ancestor` lui-même ou l'un de ses descendants.
 *
 * Comparaison segment par segment, jamais par préfixe de chaîne : `conditions[10]`
 * commence par la chaîne `conditions[1]` sans en descendre pour autant. C'est
 * exactement le genre de faux positif qui rendrait le blocage adressé par
 * chemin silencieusement faux.
 */
export function isPathInside(candidate: string, ancestor: string): boolean {
  const child = parseStrategyPath(candidate);
  const parent = parseStrategyPath(ancestor);
  if (!child || !parent || child.length < parent.length) return false;

  return parent.every((segment, index) => segment === child[index]);
}
