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
 * (`margin-tiers.md`), donc `MAINTENANCE_LEVERAGE = 2 × levier max du palier`.
 *
 * La marge isolée d'ouverture est `taille × prix d'ENTRÉE / levier`, MOINS les frais taker :
 * mesuré le 2026-11-13 sur un long ETH isolé 3x de 0,0056 à 1 925,2 (oid 604105843891). Hyperliquid
 * a rendu `rawUsd` −7,192265, soit une marge de 3,588855 = 3,593707 (taille × entrée / 3) −
 * 0,004851 (les frais de l'exécution), et `liquidationPx` 1 310,5439139942 : cette formule, avec
 * cette marge, le redonne à 10⁻¹⁰ près. L'ancienne marge (`taille × mark / levier`, sans frais)
 * donnait 1 309,66, l'estimation affichée 1 309,83.
 *
 * Ce qui la rend simple, et donc ce qui est EXIGÉ ici — sinon « not estimated », avec la raison :
 * - **isolé** : en croisé, la liquidation dépend de tout le compte (les autres positions, leur PnL) ;
 * - **aucune position déjà ouverte** sur la paire : sinon marge et prix d'entrée se fusionnent ;
 * - **premier palier** de marge : au-delà, la maintenance dépend du palier AU prix de liquidation ;
 * - **un ordre d'ouverture** : un reduce-only n'engage pas de marge.
 *
 * L'estimation reste une estimation : le prix d'entrée est celui du parcours du carnet, et la doc
 * prévient qu'il diffère du prix réel quand la liquidité bouge.
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
  /** Le taux taker du compte (0,00045 au palier 0) : les frais sortent de la marge isolée. */
  takerRate: number | null;
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
  if (input.takerRate === null || !(input.takerRate >= 0)) {
    return { status: 'not-estimated', reason: 'the taker fee rate is unknown' };
  }
  if (!(input.sz > 0) || !(input.leverage.value > 0)) {
    return { status: 'not-estimated', reason: 'no size or leverage' };
  }
  if (input.marginTableId === null) {
    return { status: 'not-estimated', reason: 'the margin table is unknown' };
  }

  const notional = input.sz * input.entryPx;
  const tier = firstTierMaxLeverage(input.marginTableId, input.marginTables, notional);
  if ('reason' in tier) return { status: 'not-estimated', reason: tier.reason };

  const side = input.isBuy ? 1 : -1;
  const l = 1 / (2 * tier.maxLeverage);
  const isolatedMargin = notional / input.leverage.value - notional * input.takerRate;
  const maintenance = l * notional;
  const marginAvailable = isolatedMargin - maintenance;
  const px = input.entryPx - (side * marginAvailable) / input.sz / (1 - l * side);

  // Un long à faible levier a une marge qui couvre une chute jusqu'à zéro, ou presque.
  if (!(px > 0)) {
    return { status: 'none', reason: 'no liquidation price above zero at this leverage' };
  }
  return { status: 'estimated', px };
}
