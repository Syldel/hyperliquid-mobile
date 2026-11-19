import type { HLOid } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * LA COUVERTURE D'UNE POSITION PAR SES TRAILING STOPS
 *
 * Plusieurs trailings peuvent protéger une même position, voulu : une sortie en paliers (50 % serré, 50 %
 * large), comme les `strategy.exit` multiples de TradingView avec leur `qty_percent`. Ce qui doit se voir
 * avant d'en poser un de plus, c'est **la somme des tailles contre la position** :
 *
 * - en dessous de 100 %, une part de la position n'a pas de trailing, et `rest` la donne : le geste naturel
 *   du palier suivant ;
 * - au-dessus, le premier déclenché peut tout fermer, et les autres n'ont plus rien à réduire — une position
 *   fermée retire ses reduce-only (`reduceOnlyCanceled`, mesuré le 2026-11-16, T4). ⚠️ Ce qu'un trailing
 *   plus grand que la position **restante** fait à son déclenchement n'est pas mesuré. C'est un
 *   avertissement, jamais un refus : sur-couvrir peut être voulu.
 *
 * Les tailles sont celles de `frontendOpenOrders` (`sz`, ce qui reste à exécuter), comparées en unités
 * entières de la grille (`szDecimals`) : 0,1 + 0,2 n'y fait pas 0,30000000000000004. Le stop du bot n'entre
 * pas dans ce compte : il a son propre avis (`botStopNotice`).
 * ============================================================================
 */

export interface TrailingCoverageInput {
  /** La taille signée de la position. */
  positionSzi: string;
  szDecimals: number;
  /** Les trailings ouverts sur la paire. */
  trailings: { oid: HLOid; sz: string }[];
  /** Le trailing en cours de remplacement : il va être annulé, il ne compte pas. */
  excludeOid: HLOid | null;
  /** La taille saisie pour le nouveau ; vide ou illisible : rien n'est ajouté au compte. */
  newSz: string;
}

export type TrailingCoverage =
  | {
      kind: 'read';
      /** La taille que les trailings comptés laissent sans trailing ; `''` s'il n'en reste pas. */
      rest: string;
      /** Avec le nouveau, la somme dépasse la position (ou la dépasse déjà sans lui). */
      over: boolean;
      text: string;
    }
  | { kind: 'unreadable'; text: string };

export function trailingCoverage(input: TrailingCoverageInput): TrailingCoverage | null {
  const counted = input.trailings.filter((t) => t.oid !== input.excludeOid);
  // Aucun autre trailing : rien à additionner, et une taille plus grande que la position est déjà refusée
  // par la saisie (`planTrailingEntry`).
  if (counted.length === 0) return null;

  const factor = 10 ** input.szDecimals;
  const units = (value: string): number => Math.round(Number(value) * factor);
  const show = (u: number): string => String(Number((u / factor).toFixed(input.szDecimals)));

  const position = Math.abs(units(input.positionSzi));
  const sizes = counted.map((t) => units(t.sz));
  if (!(position > 0) || sizes.some((s) => !Number.isFinite(s) || s < 0)) {
    return {
      kind: 'unreadable',
      text: 'A size on this pair cannot be read: how much of the position the trailing stops cover is unknown.',
    };
  }

  const covered = sizes.reduce((a, b) => a + b, 0);
  const pct = (u: number): number => Math.round((u * 100) / position);
  const rest = Math.max(position - covered, 0);
  const others = input.excludeOid === null ? 'Trailing stops' : 'The other trailing stops';

  let text = `${others} cover ${show(covered)} of ${show(position)} (${pct(covered)} %)`;
  text +=
    covered > position ? ': more than the position.' : ` · ${rest > 0 ? show(rest) : 'none'} left.`;

  const added = input.newSz.trim() === '' ? NaN : units(input.newSz);
  let over = covered > position;
  if (Number.isFinite(added) && added > 0) {
    const after = covered + added;
    over = after > position;
    text += ` With this one: ${show(after)} (${pct(after)} %)`;
    text += over
      ? ': more than the position. The first to trigger may close it all, leaving the others nothing to reduce.'
      : '.';
  }

  return { kind: 'read', rest: rest > 0 ? show(rest) : '', over, text };
}
