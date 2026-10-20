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
 *
 * **Les outcomes (HIP-4)** — `#<encodage>`, `+<encodage>` — sont un genre à part depuis les types partagés
 * 0.0.28. Avant, la règle les rangeait parmi les perps. Cette app ne les négocie pas : elle les **nomme** pour
 * ce qu'ils sont (`marketKindLabel`), les refuse avec leur vrai motif, et ne leur prête ni le vocabulaire
 * Long/Short d'un perp ni un dex qu'on n'a pas mesuré.
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
 * Ce marché est-il un perp, du dex principal ou d'un builder ? Seul un perp a une position **Long / Short**
 * avec levier ; tout autre marché — spot, outcome, nom douteux — se dit « Buy / Sell », qui décrit le sens
 * de l'ordre sans lui prêter une sémantique de perp.
 *
 * Énumère les genres **un à un** : `!isSpotMarket(name)` rangeait un outcome parmi les perps.
 */
export function isPerpMarket(name: string): boolean {
  const kind = hlMarketKind(name);
  return kind === 'perp' || kind === 'builderPerp';
}

/**
 * Le mot qui dit le sens d'un ordre : **Long / Short** pour un perp, **Buy / Sell** pour tout autre marché.
 * Un seul endroit pour la liste des ordres et leur détail, qui l'écrivaient chacun de leur côté.
 */
export function orderSideLabel(name: string, isBuy: boolean): string {
  if (isPerpMarket(name)) return isBuy ? 'Long' : 'Short';
  return isBuy ? 'Buy' : 'Sell';
}

/**
 * Ce qu'est ce nom, en mots, pour un message d'erreur : `"#10" is ${marketKindLabel('#10')}`.
 *
 * Les genres sont lus **un à un** : un genre ajouté plus tard aux types partagés ne doit pas passer pour
 * « nom malformé » — ce serait un mauvais diagnostic —, et l'affectation à `never` fait échouer la
 * compilation tant qu'on ne l'a pas lu ici.
 */
export function marketKindLabel(name: string): string {
  const kind = hlMarketKind(name);
  switch (kind) {
    case 'perp':
    case 'builderPerp':
      return 'a perp market';
    case 'spot':
      return 'a spot pair';
    case 'outcome':
      return 'an outcome market (HIP-4)';
    case null:
      return 'not a valid market name';
    default: {
      const unknownKind: never = kind;
      return `a market of kind "${String(unknownKind)}", which this app does not know`;
    }
  }
}

/**
 * Le `dex` à passer pour lire les ordres ouverts d'un marché, ou `null` quand la règle n'en connaît pas.
 *
 * - un perp se lit dans son dex (`''` pour le dex principal, le préfixe pour un HIP-3) ;
 * - un **spot** se lit avec `''` : « Spot open orders are only included with the first perp dex ». Ce n'est
 *   pas un repli, c'est ce que dit la doc ;
 * - un nom que la règle ne sait pas classer n'a pas de dex : `null`, et l'appelant refuse ;
 * - un **outcome** non plus : où l'exchange renvoie ses ordres ouverts n'a **pas été mesuré** (⚠️ docs/roadmap.md),
 *   donc le lire sur le dex principal serait une supposition. `null`, et l'appelant refuse.
 */
export function openOrdersDexOf(name: string): string | null {
  return hlMarketKind(name) === 'spot' ? '' : hlPerpDexOf(name);
}
