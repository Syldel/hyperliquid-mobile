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
 *   `reduceOnlyCanceled` (`info-endpoint.md`). **Mesuré le 2026-11-12, deux fois sur deux**, pour
 *   des stops de taille fixe sur BTC : à la même milliseconde que l'exécution de la fermeture (oids
 *   602705157250 et 602706369092). ⚠️ Pas mesuré pour un TP/SL « de position » : sa phrase dit
 *   « should », pas « cancels ».
 */
export function describeProtectiveAfterClose(
  order: HLFrontendOpenOrder,
  remainingSz: number,
): string {
  if (order.isPositionTpsl) {
    return remainingSz > 0
      ? 'follows the position: it will close what remains'
      : 'nothing left to close: Hyperliquid should cancel it';
  }
  if (remainingSz <= 0)
    return 'nothing left to reduce: Hyperliquid cancels it at once (reduceOnlyCanceled)';
  const size = Number(order.sz);
  return size > remainingSz
    ? `keeps its size ${order.sz}, larger than the ${remainingSz} left`
    : `keeps its size ${order.sz}`;
}

/** Le minimum d'Hyperliquid pour un ordre, en dollars. */
export const MIN_ORDER_VALUE_USD = 10;

/**
 * Le blocage d'une fermeture PARTIELLE sous 10 $, ou `null`.
 *
 * Mesuré le 2026-11-12, **un seul point** : un IOC reduce-only de 0,00003 BTC (≈ 2,2 $), 25 % d'une
 * position de 10,9 $, a fini `minTradeNtlRejected` (oid 602702312897). Hyperliquid n'a donc pas
 * exempté CE reduce-only du minimum.
 *
 * ⚠️ Le seuil n'est pas mesuré : bloquer jusqu'à 10 $ SUPPOSE que le minimum d'une fermeture
 * partielle est le minimum ordinaire de 10 $. Entre 2,2 et 10 $, ce blocage peut refuser une
 * fermeture qu'Hyperliquid aurait acceptée. Le choix est d'échouer tôt : fermer davantage, ou 100 %,
 * reste possible. Le mesurer demande une position d'au moins 20 $.
 *
 * Une fermeture à 100 % n'est PAS bloquée : une position qui vaut déjà moins de 10 $ doit pouvoir
 * se fermer, et ce cas-là n'a pas été mesuré — le verdict du serveur fait alors autorité.
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
  return `≈ ${value.toFixed(2)} $, under the ${MIN_ORDER_VALUE_USD} $ order minimum: Hyperliquid refused a 2.2 $ partial close (minTradeNtlRejected). Close more, or 100 %.`;
}
