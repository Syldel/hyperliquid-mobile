/**
 * Où vivent ces écarts : `core/utils`, parce que DEUX chemins en dépendent — le formulaire
 * d'ordre (`open-orders/open-form/order-limit.util.ts`) et la modale « Add protective order »
 * (`protective-order.utils.ts`). Ils ne le partageaient pas : la modale gardait un écart fixe de
 * 0,1 % quel que soit le type, dix fois plus serré que l'exemple de Freqtrade et exposé au
 * défaut que la doc officielle cite (un SL qui se déclenche sans s'exécuter dans un gap).
 * Relevé le 2026-10-18.
 */

/**
 * Les écarts entre le déclencheur et le prix limite d'un ordre déclencheur. Le déclencheur est
 * la décision (« à ce prix, j'agis ») ; le limite est une protection (« pas pire que ça »).
 * Ces trois valeurs sont des CHOIX, validés par l'utilisateur le 2026-10-16 — aucune n'a été
 * éprouvée sur des fills réels (voir `docs/roadmap.md`, « À éprouver en réel »).
 *
 * - **Au marché : 10 %.** La tolérance de glissement par défaut de l'interface officielle
 *   (doc TP/SL d'Hyperliquid : « slippage tolerance of 10% »). `p` est obligatoire dans le
 *   format d'ordre ; ce qu'Hyperliquid en fait pour un déclencheur au marché n'est pas écrit.
 * - **Stop Loss limite : 5 %.** Un SL doit sortir : un limite trop serré se déclenche sans
 *   s'exécuter dans un gap (Freqtrade recommande le stop-market pour cette raison). Pas les
 *   ~20 % de l'exemple officiel : avec un levier de 5x ou plus, la liquidation est plus
 *   proche que ça, et un limite au-delà d'elle ne protège de rien.
 * - **Take Profit limite : 1,5 %.** Un TP garde le prix visé : entre les exemples officiels
 *   (1,7 % et 2,2 %) et le 1 % de Freqtrade.
 *
 * Le sens est le même pour SL et TP : sous le déclencheur pour une vente, au-dessus pour un
 * achat — c'est le pire prix qu'on accepte pour sortir.
 */
export const LIMIT_SPREAD_MARKET = 0.1;
export const LIMIT_SPREAD_SL = 0.05;
export const LIMIT_SPREAD_TP = 0.015;

export type TriggerKind = 'sl' | 'tp';

export function limitSpread(tpsl: TriggerKind, isMarket: boolean): number {
  if (isMarket) return LIMIT_SPREAD_MARKET;
  return tpsl === 'sl' ? LIMIT_SPREAD_SL : LIMIT_SPREAD_TP;
}
