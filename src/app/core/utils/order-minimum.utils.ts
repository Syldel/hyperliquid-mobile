import type { HLOrderDetails } from '@syldel/hl-shared-types';

/**
 * Le minimum d'Hyperliquid pour la valeur d'un ordre, en dollars. Le texte du refus le nomme :
 * « Order must have minimum value of $10 » (mesuré le 2026-11-12). Une fermeture qui SOLDE la
 * position y échappe (mesuré le même jour, IOC et limite : `isBelowOrderMinimum`), pas une
 * fermeture partielle.
 *
 * Dans `core/` parce que le formulaire d'ordre ET les protections le comparent.
 */
export const MIN_ORDER_VALUE_USD = 10;

/**
 * La valeur d'un déclencheur au moment où Hyperliquid juge le minimum : sa taille × son
 * déclencheur, au marché comme limite. Ni la borne de 10 % d'un stop au marché ni le prix limite
 * d'un stop limite n'entrent dans le calcul. `null` pour un ordre qui n'est pas un déclencheur, ou
 * des nombres illisibles.
 *
 * Mesuré, au marché : 10,01 $ au déclencheur (9,01 $ à la borne) exécuté le 2026-11-12 ; 9,86 $ au
 * déclencheur accepté à la pose puis `minTradeNtlRejected` au déclenchement le 2026-11-13. En
 * limite, le 2026-11-13 : 10,18 $ au déclencheur et 9,67 $ au prix limite, exécuté (604013908327).
 * ⚠️ Rempli aussitôt, en taker ; un stop limite resté au carnet après un gap n'est pas mesuré.
 */
export function triggerOrderValueUsd(order: HLOrderDetails): number | null {
  const trigger = 'trigger' in order.orderType ? order.orderType.trigger : null;
  if (!trigger) return null;
  const price = Number(trigger.triggerPx);
  const sz = Number(order.sz);
  if (!Number.isFinite(price) || !Number.isFinite(sz) || price <= 0) return null;
  return sz * price;
}

/**
 * Le refus d'une protection qui vaudrait moins de 10 $ à son déclenchement, ou `null`.
 *
 * Hyperliquid ne la refuse PAS quand on la pose : il la refuse quand elle se déclenche, sans rien
 * exécuter, et la position reste ouverte sans elle (mesuré le 2026-11-13, oid 603956585419). C'est
 * donc ici, avant l'envoi, que ça doit se voir.
 */
export function protectiveMinimumRefusal(order: HLOrderDetails): string | null {
  const value = triggerOrderValueUsd(order);
  if (value === null || value >= MIN_ORDER_VALUE_USD) return null;
  return `≈ ${value.toFixed(2)} $ when it triggers, under the ${MIN_ORDER_VALUE_USD} $ minimum: Hyperliquid accepts it now but refuses it when it triggers, and nothing is closed.`;
}
