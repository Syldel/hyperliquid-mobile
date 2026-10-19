import type { HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * LA GRILLE D'UN MARCHÉ : LA SIENNE, OU RIEN
 *
 * `szDecimals` règle la taille et le prix qui partent vers l'exchange (`roundSize`, `roundPrice` :
 * deux fonctions qui **arrondissent**), et `maxLeverage` le levier affiché. Le formulaire d'ordre les
 * cherchait par `universe.find(m => m.name === coin || coin.includes(m.name))` : la correspondance par
 * **sous-chaîne** rend le premier nom contenu dans celui cherché, donc les données d'un autre marché.
 *
 * Mesuré le 2026-10-19 en rejouant cette règle sur les 544 perps réels (`allPerpMetas`, 11 dex) :
 * **38 marchés** recevaient les données d'un autre, **36** avec un `szDecimals` ou un `maxLeverage`
 * différent. Exemples, avec le code exact des deux arrondis : `MAVIA` (reçoit `MAV`, 0 décimale au lieu
 * de 1) — une taille saisie à 12,5 partait à **13** ; `ETHFI` (reçoit `ETH`, 4 au lieu de 1) — une
 * limite saisie à 0,52345 partait à **0,52**. Côté spot, **les 334 paires** recevaient le mauvais jeton
 * (USDC pour 317) : le nom d'affichage `BASE/QUOTE` n'égale jamais un nom de jeton, seule la
 * sous-chaîne jouait, sur les jetons dans l'ordre de leur index.
 *
 * Ici : l'égalité **exacte**, un seul résultat ou une erreur **typée** qui dit pourquoi. Jamais un
 * voisin, jamais un repli. L'appelant décide quoi faire de l'erreur — le formulaire bloque l'envoi.
 * ============================================================================
 */

/** Ce que le formulaire lit d'un marché. `maxLeverage` n'existe que pour un perp. */
export type MarketMeta =
  | { kind: 'perp'; szDecimals: number; maxLeverage: number }
  | { kind: 'spot'; szDecimals: number };

export type MarketMetaFailure =
  /** Le nom ne désigne aucun marché que la règle des types partagés sait classer. */
  | 'invalid-name'
  /** Aucun marché de ce nom dans la méta consultée. */
  | 'not-found'
  /** Plusieurs marchés portent ce nom : en choisir un serait deviner. */
  | 'ambiguous'
  /** Le marché existe, mais la grille qu'il porte n'est pas lisible (`szDecimals`, `maxLeverage`). */
  | 'unreadable';

/** Une lecture refusée, avec sa raison : le formulaire en fait un état bloquant et un message. */
export class MarketMetaError extends Error {
  constructor(
    readonly code: MarketMetaFailure,
    message: string,
  ) {
    super(message);
    this.name = 'MarketMetaError';
  }
}

/** Une grille de taille : un entier de 0 à 8 (le plus grand `szDecimals` d'un jeton spot est 8). */
function isSizeGrid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 8;
}

/**
 * Le marché perp nommé `coin` dans la méta de son dex, par égalité **exacte**.
 *
 * @throws {MarketMetaError} `not-found`, `ambiguous` ou `unreadable`.
 */
export function readPerpMarketMeta(meta: Pick<HLPerpMeta, 'universe'>, coin: string): MarketMeta {
  const matches = meta.universe.filter((market) => market.name === coin);

  if (matches.length === 0) {
    throw new MarketMetaError('not-found', `no perp market named "${coin}" in the meta of its dex`);
  }
  if (matches.length > 1) {
    throw new MarketMetaError('ambiguous', `${matches.length} perp markets are named "${coin}"`);
  }

  const [market] = matches;
  if (!isSizeGrid(market.szDecimals)) {
    throw new MarketMetaError(
      'unreadable',
      `the size decimals of "${coin}" read ${JSON.stringify(market.szDecimals)}`,
    );
  }
  if (
    typeof market.maxLeverage !== 'number' ||
    !Number.isFinite(market.maxLeverage) ||
    market.maxLeverage <= 0
  ) {
    throw new MarketMetaError(
      'unreadable',
      `the max leverage of "${coin}" reads ${JSON.stringify(market.maxLeverage)}`,
    );
  }

  return { kind: 'perp', szDecimals: market.szDecimals, maxLeverage: market.maxLeverage };
}

/**
 * La grille d'une paire spot : celle de son jeton de **base**, pas d'un jeton dont le nom se trouve
 * dans celui de la paire.
 *
 * @param protocolName le nom que l'API donne à la paire : `@107`, ou `PURR/USDC` pour la première.
 * @throws {MarketMetaError} `not-found`, `ambiguous` ou `unreadable`.
 */
export function readSpotMarketMeta(
  meta: Pick<HLSpotMeta, 'tokens' | 'universe'>,
  protocolName: string,
): MarketMeta {
  const pairs = meta.universe.filter((pair) => pair.name === protocolName);

  if (pairs.length === 0) {
    throw new MarketMetaError('not-found', `no spot pair named "${protocolName}"`);
  }
  if (pairs.length > 1) {
    throw new MarketMetaError(
      'ambiguous',
      `${pairs.length} spot pairs are named "${protocolName}"`,
    );
  }

  const baseIndex = pairs[0].tokens?.[0];
  const bases = meta.tokens.filter((token) => token.index === baseIndex);

  if (bases.length === 0) {
    throw new MarketMetaError(
      'not-found',
      `the base token (index ${baseIndex}) of "${protocolName}" is not in the token list`,
    );
  }
  if (bases.length > 1) {
    throw new MarketMetaError('ambiguous', `${bases.length} tokens carry the index ${baseIndex}`);
  }

  const [base] = bases;
  if (!isSizeGrid(base.szDecimals)) {
    throw new MarketMetaError(
      'unreadable',
      `the size decimals of the token ${base.name} read ${JSON.stringify(base.szDecimals)}`,
    );
  }

  return { kind: 'spot', szDecimals: base.szDecimals };
}
