import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { roundSize } from '@utils/hl-rounding.utils';

/**
 * ============================================================================
 * La fermeture d'une position au marché : sa taille, et ce qu'elle laisse aux TP/SL déjà posés.
 *
 * Les TP/SL ne sont **que signalés**, jamais modifiés (décidé le 2026-11-12) : réduire un stop est
 * une écriture de plus, avec son propre cas d'échec.
 * ============================================================================
 */

export const CLOSE_PERCENTS = [25, 50, 75, 100] as const;

/**
 * La taille à fermer pour un pourcentage de la position. 100 % rend la taille exacte de la position
 * (`|szi|`, déjà sur la grille) : un arrondi ne doit pas laisser un reliquat. Les autres pourcentages
 * s'arrondissent sur `szDecimals`, sans jamais dépasser la position.
 */
export function closeSize(szi: string, percent: number, szDecimals: number): string {
  const position = Math.abs(Number(szi));
  if (!(position > 0) || !(percent > 0)) return '';
  if (percent >= 100) return roundSize(position, szDecimals);
  const raw = (position * percent) / 100;
  const factor = 10 ** szDecimals;
  return (Math.floor(raw * factor + 1e-9) / factor).toFixed(szDecimals);
}

/** Les ordres qui protègent la position : reduce-only et déclencheurs, sur la même paire. */
export function protectiveOrdersOf(
  orders: HLFrontendOpenOrder[],
  coin: string,
): HLFrontendOpenOrder[] {
  return orders.filter((o) => o.coin === coin && o.reduceOnly && o.isTrigger);
}

/**
 * Ce que la fermeture fait à un TP/SL posé, d'après la doc d'Hyperliquid (lue en brut le
 * 2026-11-12) :
 * - un TP/SL « de position » (`isPositionTpsl`, taille 0) se résout sur la position au déclenchement
 *   (mesuré par le gateway le 2026-10-27, `position-level-orders.md`) ;
 * - un TP/SL de taille fixe « ne se redimensionne pas » (`take-profit-and-stop-loss-orders-tp-sl.md`) ;
 * - une fermeture totale laisse des reduce-only qui ne réduisent plus rien : statut
 *   `reduceOnlyCanceled` (`info-endpoint.md`). ⚠️ Le délai de cette annulation n'est pas mesuré.
 */
export function describeProtectiveAfterClose(
  order: HLFrontendOpenOrder,
  remainingSz: number,
): string {
  if (order.isPositionTpsl) {
    return remainingSz > 0
      ? 'follows the position: it will close what remains'
      : 'nothing left to close: Hyperliquid cancels it';
  }
  if (remainingSz <= 0)
    return 'nothing left to reduce: Hyperliquid cancels it (reduceOnlyCanceled)';
  const size = Number(order.sz);
  return size > remainingSz
    ? `keeps its size ${order.sz}, larger than the ${remainingSz} left`
    : `keeps its size ${order.sz}`;
}
