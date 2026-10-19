import { hlMarketKind, hlPerpDexOf } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * « EST-CE UN SPOT ? » ET « DE QUEL DEX ? » : LA RÈGLE DES TYPES PARTAGÉS, ET RIEN D'AUTRE
 *
 * `hlMarketKind` et `hlPerpDexOf` (`@syldel/hl-shared-types`) portent la règle de nommage, que le bot
 * consomme aussi. Avant le 2026-10-19 le mobile en gardait **cinq copies**, toutes différentes :
 * `includes('/')` (liste des ordres, `getAssetIndex`), `includes('/') || includes('-')` (formulaire,
 * détail), `startsWith('@') || includes('/')` (résolution des noms), plus deux découpes sur `:`
 * (`parseCoin`, `extractDex`).
 *
 * Mesuré le 2026-10-19 sur les 334 paires spot réelles (`spotMeta`) : sous leur nom BRUT — celui que
 * l'exchange renvoie dans les ordres et les fills —, `includes('/')` n'en reconnaît que **1** (`PURR/USDC`) ;
 * les 333 autres s'appellent `@N`. Une paire spot `@N` était donc affichée « Long/Short » dans la liste des
 * ordres, et `getAssetIndex` l'envoyait dans la branche perp (« Perp asset not found ») : son ordre ne
 * s'annulait pas depuis l'app. Sous leur nom d'affichage (`BASE/QUOTE`) les trois règles s'accordaient, ce
 * qui masquait le défaut. Les découpes sur `:` concordaient avec `hlPerpDexOf` sur les 878 noms réels : pour
 * elles, c'est une consolidation, pas un défaut mesuré.
 *
 * Sources, relues le 2026-10-19 : « Info endpoint » — « For Spot, coin should be `PURR/USDC` for PURR, and
 * `@{index}` … for all other spot tokens » ; « Spot open orders are only included with the first perp dex » ;
 * « Asset IDs » — `10000 + spotInfo["index"]`, et les perps de builder « always » `{dex}:{coin}`.
 * ============================================================================
 */

/**
 * Cette paire est-elle un marché spot ? `PURR/USDC`, `HYPE/USDC` (nom d'affichage) et `@107` (nom brut)
 * le sont ; un perp, un perp de builder, un outcome et un nom que la règle ne classe pas, non.
 *
 * `false` pour un nom douteux est un choix d'**affichage** (libellés, arrondi) : l'envoi d'un ordre, lui,
 * est bloqué pour un nom que `hlMarketKind` ne classe pas (`getMarketMeta`, `market-meta-state.util.ts`).
 */
export function isSpotMarket(name: string): boolean {
  return hlMarketKind(name) === 'spot';
}

/**
 * Le `dex` à passer pour lire les ordres ouverts d'un marché, ou `null` quand la règle n'en connaît pas.
 *
 * - un perp se lit dans son dex (`''` pour le dex principal, le préfixe pour un HIP-3) ;
 * - un **spot** se lit avec `''` : « Spot open orders are only included with the first perp dex ». Ce n'est
 *   pas un repli, c'est ce que dit la doc ;
 * - un nom que la règle ne sait pas classer n'a pas de dex : `null`, et l'appelant refuse.
 */
export function openOrdersDexOf(name: string): string | null {
  return hlMarketKind(name) === 'spot' ? '' : hlPerpDexOf(name);
}
