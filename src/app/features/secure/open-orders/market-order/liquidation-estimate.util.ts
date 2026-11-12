import type { HlActiveAssetLeverage, HLPerpMarginTableEntry } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * Le prix de liquidation estimé d'une position qu'un ordre au marché va OUVRIR, en marge isolée
 * seulement (décidé le 2026-11-12 : « seulement si c'est simple à calculer »).
 *
 * La formule est celle de la doc d'Hyperliquid (`trading/liquidations.md`, lue en brut le
 * 2026-11-12) :
 *
 *     liq_price = price - side * margin_available / position_size / (1 - l * side)
 *     margin_available (isolated) = isolated_margin - maintenance_margin_required
 *     l = 1 / MAINTENANCE_LEVERAGE
 *
 * et la maintenance est « la moitié de la marge initiale au levier maximal » du palier
 * (`margin-tiers.md`), donc `MAINTENANCE_LEVERAGE = 2 × levier max du palier`. La marge isolée
 * d'ouverture est `taille × mark / levier` (`margining.md`).
 *
 * Ce qui la rend simple, et donc ce qui est EXIGÉ ici — sinon « not estimated », avec la raison :
 * - **isolé** : en croisé, la liquidation dépend de tout le compte (les autres positions, leur PnL) ;
 * - **aucune position déjà ouverte** sur la paire : sinon marge et prix d'entrée se fusionnent ;
 * - **premier palier** de marge : au-delà, la maintenance dépend du palier AU prix de liquidation ;
 * - **un ordre d'ouverture** : un reduce-only n'engage pas de marge.
 *
 * ⚠️ Non vérifié (2026-11-12) : si les frais taker se prélèvent sur la marge isolée. L'écart serait
 * de l'ordre du taux taker (0,045 % au palier 0) rapporté au notionnel. La doc prévient aussi
 * qu'une estimation d'entrée diffère du prix réel quand la liquidité bouge.
 * ============================================================================
 */

export type LiquidationEstimate =
  | { status: 'estimated'; px: number }
  | { status: 'none'; reason: string }
  | { status: 'not-estimated'; reason: string };

export interface LiquidationInput {
  reduceOnly: boolean;
  isBuy: boolean;
  sz: number;
  /** Le prix moyen d'exécution estimé (parcours du carnet). */
  entryPx: number | null;
  markPx: number | null;
  leverage: HlActiveAssetLeverage | null;
  /** `null` : on ne sait pas s'il y a une position. */
  hasPosition: boolean | null;
  marginTableId: number | null;
  marginTables: HLPerpMarginTableEntry[] | null;
}

/**
 * Le levier maximal du premier palier, ou la raison pour laquelle on ne le connaît pas pour CE
 * notionnel. « Pour les ids inférieurs à 50, un seul palier dont le levier max est l'id »
 * (`margin-tiers.md`).
 */
export function firstTierMaxLeverage(
  marginTableId: number,
  marginTables: HLPerpMarginTableEntry[] | null,
  notional: number,
): { maxLeverage: number } | { reason: string } {
  if (marginTableId < 50) return { maxLeverage: marginTableId };

  const entry = marginTables?.find(([id]) => id === marginTableId);
  if (!entry) return { reason: `margin table ${marginTableId} is not in the market meta` };

  const tiers = [...entry[1].marginTiers].sort(
    (a, b) => Number(a.lowerBound) - Number(b.lowerBound),
  );
  const first = tiers[0];
  if (!first || Number(first.lowerBound) !== 0 || !(first.maxLeverage > 0)) {
    return { reason: `margin table ${marginTableId} has no first tier starting at 0` };
  }
  const next = tiers[1];
  if (next && notional >= Number(next.lowerBound)) {
    return { reason: 'the position would be above the first margin tier' };
  }
  return { maxLeverage: first.maxLeverage };
}

export function estimateLiquidation(input: LiquidationInput): LiquidationEstimate {
  if (input.reduceOnly) {
    return { status: 'not-estimated', reason: 'reduce-only order: it opens no margin' };
  }
  if (input.leverage === null) {
    return { status: 'not-estimated', reason: 'the margin mode is unknown' };
  }
  if (input.leverage.type !== 'isolated') {
    return {
      status: 'not-estimated',
      reason: 'cross margin: it depends on the whole account',
    };
  }
  if (input.hasPosition === null) {
    return { status: 'not-estimated', reason: 'the current position could not be read' };
  }
  if (input.hasPosition) {
    return { status: 'not-estimated', reason: 'it adds to an open position' };
  }
  if (input.entryPx === null || !(input.entryPx > 0)) {
    return { status: 'not-estimated', reason: 'no estimated fill price' };
  }
  if (input.markPx === null || !(input.markPx > 0)) {
    return { status: 'not-estimated', reason: 'no mark price' };
  }
  if (!(input.sz > 0) || !(input.leverage.value > 0)) {
    return { status: 'not-estimated', reason: 'no size or leverage' };
  }
  if (input.marginTableId === null) {
    return { status: 'not-estimated', reason: 'the margin table is unknown' };
  }

  const tier = firstTierMaxLeverage(
    input.marginTableId,
    input.marginTables,
    input.sz * input.entryPx,
  );
  if ('reason' in tier) return { status: 'not-estimated', reason: tier.reason };

  const side = input.isBuy ? 1 : -1;
  const l = 1 / (2 * tier.maxLeverage);
  const isolatedMargin = (input.sz * input.markPx) / input.leverage.value;
  const maintenance = l * input.sz * input.entryPx;
  const marginAvailable = isolatedMargin - maintenance;
  const px = input.entryPx - (side * marginAvailable) / input.sz / (1 - l * side);

  // Un long à faible levier a une marge qui couvre une chute jusqu'à zéro, ou presque.
  if (!(px > 0)) {
    return { status: 'none', reason: 'no liquidation price above zero at this leverage' };
  }
  return { status: 'estimated', px };
}
