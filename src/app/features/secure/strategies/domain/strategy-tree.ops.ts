import type { LogicalGroup, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import {
  childPath,
  parseStrategyPath,
  STRATEGY_PATH_ROOT,
  type StrategyPathSegment,
} from './strategy-path.util';

/**
 * ============================================================================
 * 🌲 STRATEGY TREE OPS
 * Lecture et édition immuables d'un `StrategyRules`, adressées par les chemins
 * de strategy-path.util.ts.
 *
 * Deux propriétés structurantes, toutes deux couvertes par les tests :
 *
 * 1. **Partage structurel** — seuls les conteneurs traversés sont clonés. Un
 *    sous-arbre non touché garde son identité référentielle, donc un nœud que
 *    ce build ne sait pas interpréter (document écrit par une version plus
 *    récente) traverse une édition sans être ni relu ni reconstruit. C'est la
 *    réécriture « verbatim » actée : elle n'est pas une discipline à tenir à
 *    l'appel, elle est portée par ces fonctions.
 * 2. **Aucune création implicite** — un chemin dont un maillon intermédiaire
 *    n'existe pas laisse l'objet inchangé, et la même référence est renvoyée.
 *    Un appelant peut donc comparer par identité pour savoir si son opération
 *    a porté.
 *
 * Volontairement typées `unknown` en lecture : l'arbre peut contenir des nœuds
 * hors union (voir ci-dessus), les rétrécir est la responsabilité de
 * l'appelant, via `isLogicalGroup` / la validation partagée.
 * ============================================================================
 */

/** Segments relatifs à l'objet `StrategyRules`, racine `rules` retirée. */
function toRelativeSegments(path: string): StrategyPathSegment[] | null {
  const segments = parseStrategyPath(path);
  if (!segments || segments.length === 0) return null;
  if (segments[0] !== STRATEGY_PATH_ROOT) return null;
  return segments.slice(1);
}

function readIn(root: unknown, segments: readonly StrategyPathSegment[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment as string];
  }
  return current;
}

function writeIn(
  container: unknown,
  segments: readonly StrategyPathSegment[],
  value: unknown,
): unknown {
  if (segments.length === 0) return value;
  if (container === null || typeof container !== 'object') return container;

  const [head, ...rest] = segments;
  const key = head as string;
  const record = container as Record<string, unknown>;
  const child = record[key];

  let nextChild: unknown;

  if (rest.length === 0) {
    // Écrire la valeur qui s'y trouve déjà ne change rien : on ressort la même
    // référence plutôt qu'un clone identique.
    if (child === value && Object.prototype.hasOwnProperty.call(record, key)) return container;
    nextChild = value;
  } else {
    // Maillon intermédiaire absent : on ne fabrique rien en chemin.
    if (child === null || typeof child !== 'object') return container;

    nextChild = writeIn(child, rest, value);
    // Le niveau inférieur n'a rien changé : ne pas cloner non plus à ce
    // niveau-ci, sans quoi un no-op profond remonterait quand même en objet
    // neuf et casserait la comparaison par identité de l'appelant.
    if (nextChild === child) return container;
  }

  const clone: Record<string, unknown> = Array.isArray(container)
    ? ([...container] as unknown as Record<string, unknown>)
    : { ...record };

  clone[key] = nextChild;
  return clone;
}

/** Nœud, opérande ou valeur situé à `path`, ou `undefined` si le chemin ne mène nulle part. */
export function getAtPath(rules: StrategyRules, path: string): unknown {
  const segments = toRelativeSegments(path);
  return segments ? readIn(rules, segments) : undefined;
}

/**
 * Remplace ce qui se trouve à `path`. Le dernier segment peut ne pas exister
 * encore (création d'`exit` sur un côté existant, par exemple) ; un maillon
 * intermédiaire manquant, lui, annule l'opération.
 */
export function replaceAtPath(rules: StrategyRules, path: string, value: unknown): StrategyRules {
  const segments = toRelativeSegments(path);
  if (!segments || segments.length === 0) return rules;
  return writeIn(rules, segments, value) as StrategyRules;
}

/**
 * Supprime ce qui se trouve à `path` : `splice` dans un tableau (les index
 * suivants se décalent, comme attendu d'une liste de conditions), `delete` sur
 * une clé d'objet.
 */
export function removeAtPath(rules: StrategyRules, path: string): StrategyRules {
  const segments = toRelativeSegments(path);
  if (!segments || segments.length === 0) return rules;

  const parentSegments = segments.slice(0, -1);
  const last = segments[segments.length - 1];
  const parent = readIn(rules, parentSegments);

  if (parent === null || typeof parent !== 'object') return rules;

  if (Array.isArray(parent)) {
    if (typeof last !== 'number' || last < 0 || last >= parent.length) return rules;
    const next = [...parent];
    next.splice(last, 1);
    return writeIn(rules, parentSegments, next) as StrategyRules;
  }

  if (!Object.prototype.hasOwnProperty.call(parent, last)) return rules;
  const next = { ...(parent as Record<string, unknown>) };
  delete next[last as string];
  return writeIn(rules, parentSegments, next) as StrategyRules;
}

/**
 * Garde de type défensive : l'arbre peut contenir des nœuds hors union, donc
 * `node.type === 'logical'` seul ne suffit pas à garantir `conditions`.
 */
export function isLogicalGroup(node: unknown): node is LogicalGroup {
  return (
    node !== null &&
    typeof node === 'object' &&
    (node as { type?: unknown }).type === 'logical' &&
    Array.isArray((node as { conditions?: unknown }).conditions)
  );
}

/** Ajoute une condition à la fin d'un groupe logique. Sans effet si `path` n'en désigne pas un. */
export function appendCondition(
  rules: StrategyRules,
  logicalGroupPath: string,
  node: RuleNode,
): StrategyRules {
  const group = getAtPath(rules, logicalGroupPath);
  if (!isLogicalGroup(group)) return rules;

  return replaceAtPath(rules, childPath(logicalGroupPath, 'conditions'), [
    ...group.conditions,
    node,
  ]);
}

function isEmptyLogicalGroup(node: unknown): boolean {
  return isLogicalGroup(node) && node.conditions.length === 0;
}

/**
 * Retire les branches restées vides, pour que ce qui est écrit dans la
 * bibliothèque ne porte jamais de coquille inutile.
 *
 * Découle de la décision « brouillon autorisé » : enregistrer ne bloque
 * jamais, mais une branche à laquelle l'utilisateur n'a rien mis n'a pas à
 * être persistée. Trois cas, et un seul est subtil :
 *
 * - `exit` vide → retirée ;
 * - `entry` vide **et** pas d'`exit` → le côté entier est retiré ;
 * - `entry` vide mais `exit` renseigné → **les deux sont conservés**. `entry`
 *   est obligatoire dans `SideRules` : le retirer forcerait à jeter aussi le
 *   travail fait sur `exit`. Un groupe `entry` vide reste un `LogicalGroup`
 *   parfaitement typé ; seule la validation le signalera, au moment d'attacher
 *   la stratégie — pas au moment de l'enregistrer.
 *
 * Les clés de premier niveau inconnues de ce build sont conservées telles
 * quelles (réécriture verbatim) : seuls `long` et `short` sont inspectés.
 */
export function pruneEmptyRuleBranches(rules: StrategyRules): StrategyRules {
  const next: StrategyRules = { ...rules };
  let changed = false;

  for (const side of ['long', 'short'] as const) {
    const config = next[side];
    if (!config) continue;

    const hasUsefulExit = config.exit !== undefined && !isEmptyLogicalGroup(config.exit);

    if (isEmptyLogicalGroup(config.entry) && !hasUsefulExit) {
      delete next[side];
      changed = true;
      continue;
    }

    if (config.exit !== undefined && !hasUsefulExit) {
      const { exit: _dropped, ...rest } = config;
      next[side] = rest;
      changed = true;
    }
  }

  return changed ? next : rules;
}
