import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { roundSize } from '@utils/hl-rounding.utils';
import { MIN_ORDER_VALUE_USD } from '@utils/order-minimum.utils';

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
 *   `reduceOnlyCanceled` (`info-endpoint.md`). **Mesuré le 2026-11-12, trois fois sur trois**, pour
 *   des stops de taille fixe (BTC long, ETH short) : à la même milliseconde que l'exécution de la
 *   fermeture (oids 602705157250, 602706369092, 602789574942). **Et pour un TP/SL « de
 *   position »** le 2026-11-13 : `reduceOnlyCanceled` à la même milliseconde (oid 603932533273,
 *   à côté d'un stop de taille fixe annulé au même instant). D'où une seule phrase pour les deux.
 */
export function describeProtectiveAfterClose(
  order: HLFrontendOpenOrder,
  remainingSz: number,
): string {
  if (remainingSz <= 0)
    return 'nothing left to reduce: Hyperliquid cancels it at once (reduceOnlyCanceled)';
  if (order.isPositionTpsl) return 'follows the position: it will close what remains';
  const size = Number(order.sz);
  return size > remainingSz
    ? `keeps its size ${order.sz}, larger than the ${remainingSz} left`
    : `keeps its size ${order.sz}`;
}

/**
 * Le blocage d'une fermeture PARTIELLE sous 10 $, ou `null`.
 *
 * Mesuré le 2026-11-12, deux fois : Hyperliquid refuse une fermeture partielle reduce-only sous
 * 10 $, avec `minTradeNtlRejected`.
 * - 0,00003 BTC (≈ 2,2 $), 25 % d'une position de 10,9 $ (oid 602702312897) ;
 * - 0,00013 BTC (≈ 9,29 $), sur une position de 21,4 $ (oid 603242720281), avec le texte « Order
 *   must have minimum value of $10. asset=0 ». Ce point a été mesuré en levant ce blocage dans une
 *   copie de travail, le temps d'un envoi.
 * Le seuil est donc le minimum ordinaire de 10 $ : le texte le nomme, et 9,29 $ est refusé. Bloquer
 * ici évite un refus connu.
 *
 * Une fermeture à 100 % n'est PAS bloquée : une position qui vaut déjà moins de 10 $ doit pouvoir
 * se fermer, et Hyperliquid l'accepte — mesuré le 2026-11-12, 0,00001 BTC (≈ 0,71 $) fermé à 100 %
 * depuis le mobile et rempli (oid 603233856328).
 *
 * `markPx` : la valeur de la position divisée par sa taille (`positionValue / |szi|`).
 */
export function partialCloseRefusal(input: {
  closeSz: number;
  positionSz: number;
  markPx: number | null;
}): string | null {
  const { closeSz, positionSz, markPx } = input;
  if (!(closeSz > 0) || !(positionSz > 0) || markPx === null || !(markPx > 0)) return null;
  if (closeSz >= positionSz - 1e-12) return null;
  const value = closeSz * markPx;
  if (value >= MIN_ORDER_VALUE_USD) return null;
  return `≈ ${value.toFixed(2)} $, under the ${MIN_ORDER_VALUE_USD} $ order minimum: Hyperliquid refuses a partial close below it, even reduce-only. Close more, or 100 %.`;
}
