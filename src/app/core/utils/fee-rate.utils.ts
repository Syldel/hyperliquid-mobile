import { hlPerpDexOf } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * 💱 LIRE ET ÉCRIRE UN TAUX DE FRAIS
 *
 * Hyperliquid rend ses taux en **chaînes décimales** et en fractions :
 * `'0.00045'` pour 0,045 %. Deux pièges y tiennent, et les deux ont déjà coûté
 * quelque chose dans cet écosystème.
 *
 * 1. `Number('')` rend `0`, soit un taux parfaitement plausible. Une réponse
 *    tronquée passerait donc pour « aucun frais » au lieu de « illisible ».
 * 2. Le produit par 100 ne tombe pas toujours juste : `0.00035 * 100` rend
 *    `0.034999999999999996`. Le palier de base (`0.00045`), lui, tombe juste —
 *    de quoi croire le problème inexistant si on ne l'éprouve que sur celui-là.
 *    C'est exactement ce qui est arrivé le 2026-10-11, et une mutation l'a
 *    rattrapé.
 *
 * ⚠️ Un taux **négatif** est légitime : c'est un rebate d'apporteur de
 * liquidité, que la documentation publie jusqu'à `-0.00003`, et que le point de
 * terminaison `userFees` porte dans `feeSchedule.tiers.mm[].add`. Le refuser
 * cacherait de l'argent reçu.
 * ============================================================================
 */

/**
 * Le motif d'un décimal acceptable, sans tolérance d'espaces ni d'exposant.
 *
 * Même choix que `snapshot-reading.ts` côté bot : `Number` accepterait
 * `' 0.5 '` et `'1e-4'`, formes qu'Hyperliquid n'a jamais envoyées. En accepter
 * une reviendrait à deviner ce qu'un serveur a voulu dire.
 */
const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * `'0.00045'` → `0.00045`. `null` dès que la chaîne n'est pas un décimal — y
 * compris vide, absente, ou suivie de n'importe quoi.
 */
export function parseDecimalRate(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * `0.00045` → `'0.045%'`, `-0.00001` → `'-0.001%'`.
 *
 * L'arrondi à six décimales retire la queue du produit flottant sans toucher
 * aux paliers réels, dont le plus fin publié est `0.00001` → `0.001 %`.
 */
export function formatRatePercent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(6))}%`;
}

/** La forme affichable d'un taux servi en chaîne, ou `null` s'il est illisible. */
export function formatDecimalRate(raw: string | null | undefined): string | null {
  const fraction = parseDecimalRate(raw);
  return fraction === null ? null : formatRatePercent(fraction);
}

/**
 * Le dex d'un marché **déployé par un tiers** (HIP-3), ou `null` quand le
 * palier du compte s'applique tel quel.
 *
 * ⚠️ **Ce n'est pas une question de nommage, c'est une question de frais.** Le
 * point de terminaison `userFees` rend un palier **unique pour tout le
 * compte** — la documentation d'Hyperliquid le dit : « all assets, including
 * HIP-3 perps, share one fee tier per user ». Mais ce que l'on paie sur un
 * marché HIP-3 vaut ce palier **multiplié** : taux du trader × échelle de frais
 * du déployeur × 0,1 si le marché est en *growth mode* × (1 − remise de
 * parrainage). Sous *growth mode*, la documentation chiffre le taker entre
 * 0,0045 % et 0,009 %, soit cinq à dix fois moins que les 0,045 % du palier de
 * base.
 *
 * L'écran des remplissages affichait donc « Your rates » au-dessus d'une liste
 * où certaines lignes pouvaient avoir payé tout autre chose. Il ne peut pas
 * calculer le vrai taux — l'échelle du déployeur n'est lue par personne dans
 * cet écosystème, voir `nest-trading-bot/docs/known-gaps.md` — mais il peut
 * **dire lesquelles sont concernées**, et c'est ce que cette fonction permet.
 *
 * `hlPerpDexOf` rend `''` pour le dex principal et `null` hors perp : les deux
 * veulent dire « le palier s'applique », d'où un seul `null` ici.
 */
export function builderDexOf(market: string): string | null {
  return hlPerpDexOf(market) || null;
}
