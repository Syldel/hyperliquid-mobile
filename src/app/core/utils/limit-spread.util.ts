/**
 * Le prix limite `p` d'un ordre déclencheur : ce que l'exchange en fait dépend de son type.
 *
 * - **Déclencheur AU MARCHÉ : `p` est ignoré.** Mesuré le 2026-10-18 sur l'historique du compte
 *   (`historicalOrders`, 26 stops et take-profits au marché déclenchés, BTC et SOL, achats et
 *   ventes) : quel que soit le `p` posé (le déclencheur lui-même, +8 %, ou ses 90 %), la ligne
 *   `filled` de l'ordre déclenché porte une borne de **déclencheur × 0,9 pour une vente,
 *   × 1,1 pour un achat**, arrondie selon une règle que `marketTriggerBound` reproduit. L'exchange
 *   recrée l'ordre avec SA borne de 10 %, la tolérance de glissement par défaut de sa doc. Le champ
 *   reste obligatoire dans le format d'ordre ; on y met ce que l'exchange recalculera, pour que ce
 *   qu'on pose se lise comme ce qui sera exécuté.
 * - **Déclencheur LIMITE : `p` est le prix de l'ordre posé au déclenchement**, donc un vrai
 *   plancher (voir `LIMIT_SPREAD_*`). ⚠️ Jamais observé au déclenchement : le seul take-profit
 *   limite posé en réel (2026-10-18) n'a pas été déclenché.
 *
 * Où vit ce fichier : `core/utils`, parce que DEUX chemins en dépendent — le formulaire d'ordre
 * (`open-orders/open-form/order-limit.util.ts`) et la modale « Add protective order »
 * (`protective-order.utils.ts`).
 */

/** La borne de glissement que l'exchange applique lui-même à un déclencheur au marché : 10 %. */
const MARKET_BOUND_SELL_TENTHS = 9n; // × 9/10 : sous le déclencheur pour une vente
const MARKET_BOUND_BUY_TENTHS = 11n; // × 11/10 : au-dessus pour un achat

/**
 * Les écarts d'un déclencheur LIMITE. Le déclencheur est la décision (« à ce prix, j'agis ») ; le
 * limite est un plancher (« pas pire que ça »). Ces deux valeurs sont des CHOIX, validés par
 * l'utilisateur le 2026-10-16 — aucune n'a été éprouvée sur un fill réel (voir `docs/roadmap.md`,
 * « À éprouver en réel »).
 *
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
export const LIMIT_SPREAD_SL = 0.05;
export const LIMIT_SPREAD_TP = 0.015;

export type TriggerKind = 'sl' | 'tp';

/** L'écart d'un déclencheur LIMITE. Un déclencheur au marché n'en a pas : `marketTriggerBound`. */
export function limitSpread(tpsl: TriggerKind): number {
  return tpsl === 'sl' ? LIMIT_SPREAD_SL : LIMIT_SPREAD_TP;
}

/**
 * La borne que l'exchange calcule pour un déclencheur au marché : déclencheur × 0,9 (vente) ou
 * × 1,1 (achat), à la grille de prix d'Hyperliquid (5 chiffres significatifs, au plus
 * `6 − szDecimals` décimales en perp, `8 − szDecimals` en spot, un entier toujours valide).
 *
 * **L'arrondi, tel qu'il se lit sur ses ordres** : un achat est **tronqué**, une vente est
 * tronquée **puis relevée d'un tick** — y compris quand le produit tombe juste (78130 × 0,9 =
 * 70317 exactement, l'exchange écrit 70318 ; 79960 × 1,1 = 87956 exactement, il écrit 87956).
 * Cette règle reproduit les **26 ordres déclenchés** de l'historique du compte (2026-10-18), les
 * deux produits exacts compris. ⚠️ Elle est **déduite** de ces ordres, pas documentée : la raison
 * du tick de plus pour une vente n'est pas connue, et les deux produits exacts sont des entiers
 * BTC (décimales 0). Sans conséquence aujourd'hui, car `p` est ignoré au marché.
 *
 * `''` quand le déclencheur n'est pas un décimal simple : l'appelant n'a alors rien à proposer.
 */
export function marketTriggerBound(params: {
  triggerPx: string;
  isBuy: boolean;
  szDecimals: number;
  isSpot: boolean;
}): string {
  const text = params.triggerPx.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return '';
  const [int, frac = ''] = text.split('.');

  // Produit exact, avec une décimale de plus que le déclencheur.
  const tenths = params.isBuy ? MARKET_BOUND_BUY_TENTHS : MARKET_BOUND_SELL_TENTHS;
  const units = BigInt(`${int}${frac}`) * tenths;
  if (units === 0n) return '';
  const scale = frac.length + 1;

  // Les décimales que ce prix a le droit d'avoir : le plus petit de deux plafonds.
  const digits = units.toString();
  const integerDigits = digits.length - scale;
  // Un entier a `integerDigits` chiffres significatifs avant la virgule ; sous 1, les zéros
  // après la virgule ne comptent pas.
  const bySignificantFigures = integerDigits > 0 ? 5 - integerDigits : 5 + (scale - digits.length);
  const byGrid = Math.max((params.isSpot ? 8 : 6) - params.szDecimals, 0);
  const decimals = Math.min(byGrid, Math.max(bySignificantFigures, 0));

  // Tronqué ; une vente est ensuite relevée d'un tick (voir plus haut).
  const truncated =
    scale > decimals
      ? units / 10n ** BigInt(scale - decimals)
      : units * 10n ** BigInt(decimals - scale);
  const kept = params.isBuy ? truncated : truncated + 1n;

  const padded = kept.toString().padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = decimals > 0 ? padded.slice(padded.length - decimals).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}
