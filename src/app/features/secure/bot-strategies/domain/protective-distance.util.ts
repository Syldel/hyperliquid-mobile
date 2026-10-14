import type { DistanceUnit } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 📏 LA DISTANCE D'UNE PROTECTION, TELLE QU'ELLE S'AFFICHE
 *
 * Le badge de la liste écrivait `{{ e.distance?.unit === 'PERCENT' ? '%' :
 * '×ATR' }}`, et ce ternaire inventait dans deux cas distincts :
 *
 * - **une distance absente devenait `×ATR`** — le badge affichant alors
 *   `SL 100% · ×ATR`, une unité sortie de nulle part et aucun nombre, sur
 *   l'écran qui configure de vrais ordres. Le cas n'est pas théorique :
 *   `atrMultiplier` a été remplacé par `distance` (les types partagés le
 *   refusent nommément, avec un message de migration), donc une entrée écrite
 *   avant la bascule n'en porte pas. Le type déclare pourtant `distance`
 *   obligatoire — il décrit ce que ce mobile **écrit**, pas ce qui dort en
 *   base. Même divergence que `shortname` dans `pair-strategy-status.util.ts`,
 *   et c'est elle que `StoredPriceDistance` remet sous les yeux de l'appelant ;
 * - **une unité que ce build ignore devenait `×ATR` aussi.** Les unités sont
 *   servies par `GET /exchanges/meta` (`distanceUnits`) et le sélecteur de la
 *   modale les propose telles quelles : un bot plus récent peut donc faire
 *   enregistrer une unité absente de ce paquet. Côté bot, `priceOffsetFor` est
 *   un `switch` sans `default` qui rend un `number` — une unité de plus y est
 *   une **erreur de compilation**. Un ternaire de gabarit n'offre pas cette
 *   garantie ; la table typée ci-dessous la rétablit ici.
 *
 * ⚠️ Ce que cet affichage ne fait pas : la bannière « not runnable » ne sait
 * rien d'une distance manquante. Le bot, lui, lit `distance.unit` sans garde
 * dans `protective-plan.ts` et lève donc avant de poser **aucune** protection
 * de cette paire. Le badge le dit, le bandeau rouge non — porter ce motif
 * jusqu'à `pairStrategyStatus` est une décision à prendre à part.
 * ============================================================================
 */

/**
 * Une distance **telle qu'elle dort en base**, par opposition à `PriceDistance`
 * que le paquet partagé décrit aujourd'hui : l'unité y est une chaîne
 * quelconque et la valeur peut manquer. Un vrai `PriceDistance` s'y assigne
 * sans cast — c'est le type qui s'élargit, pas la donnée qui se dégrade.
 */
export interface StoredPriceDistance {
  unit?: string;
  value?: number;
}

/**
 * Le suffixe compact de chaque unité, tel qu'il se colle au nombre.
 *
 * `Record<DistanceUnit, …>` et non `Record<string, …>` : ajouter une unité aux
 * types partagés doit casser cette table à la compilation, comme elle casse le
 * `switch` du bot.
 */
const UNIT_SUFFIXES: Record<DistanceUnit, string> = {
  ATR: '×ATR',
  PERCENT: '%',
};

/** Ce qu'affiche un badge dont la distance ne permet aucun calcul. */
export const MISSING_DISTANCE_LABEL = 'no distance';

/**
 * Le suffixe d'une unité, ou **le code lui-même** quand ce build ne le connaît
 * pas — le choix que fait déjà `exitBehaviorLabels()[x] || x` dans le même
 * gabarit : montrer ce qui est stocké vaut mieux que de le traduire au hasard.
 */
export function distanceUnitSuffix(unit?: string): string {
  if (!unit) return '';
  return UNIT_SUFFIXES[unit as DistanceUnit] ?? unit;
}

/**
 * La distance d'une protection, nombre et unité ensemble.
 *
 * Une valeur non numérique vaut une absence : le bot ne peut pas plus
 * multiplier `undefined` qu'une chaîne, et un badge qui montrerait `×ATR` sans
 * nombre laisserait croire à une protection posée.
 */
export function protectiveDistanceLabel(distance?: StoredPriceDistance): string {
  const value = distance?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return MISSING_DISTANCE_LABEL;

  const unit = distance?.unit;
  if (!unit) return MISSING_DISTANCE_LABEL;

  // Un symbole se colle au nombre, un code inconnu s'en détache : `10%` et
  // `1.5×ATR` se lisent d'un bloc, `3TICKS` non.
  const suffix = UNIT_SUFFIXES[unit as DistanceUnit];
  return suffix === undefined ? `${value} ${unit}` : `${value}${suffix}`;
}
