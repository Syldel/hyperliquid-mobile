import { MarketMetaError, readPerpMarketMeta, readSpotMarketMeta } from './market-meta.util';

/**
 * Les valeurs viennent de la lecture publique du 2026-10-19 (`allPerpMetas`, 11 dex, 544 perps ;
 * `spotMeta`, 334 paires) : chaque `[szDecimals, maxLeverage]` ci-dessous est celui que l'API rend
 * pour ce marché, recopié à la main.
 *
 * L'ORDRE de l'univers compte : l'ancienne règle (`name === coin || coin.includes(m.name)`) rendait le
 * premier nom contenu dans celui cherché, donc un nom court listé AVANT le long le captait. Ici les noms
 * courts précèdent, comme dans l'univers réel du dex principal.
 */
const SHORT_NAMES_FIRST = [
  { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
  { name: 'OP', szDecimals: 1, maxLeverage: 5 },
  { name: 'AR', szDecimals: 2, maxLeverage: 5 },
  { name: 'W', szDecimals: 1, maxLeverage: 5 },
  { name: 'IO', szDecimals: 1, maxLeverage: 3 },
  { name: 'MAV', szDecimals: 0, maxLeverage: 3 },
  { name: 'AI', szDecimals: 1, maxLeverage: 3 },
  // Les marchés dont le nom en contient un autre, avec LEURS valeurs.
  { name: 'PEOPLE', szDecimals: 0, maxLeverage: 3 },
  { name: 'MAVIA', szDecimals: 1, maxLeverage: 3 },
  { name: 'ETHFI', szDecimals: 1, maxLeverage: 5 },
  { name: 'HBAR', szDecimals: 0, maxLeverage: 5 },
  { name: 'POPCAT', szDecimals: 0, maxLeverage: 3 },
  { name: 'MEW', szDecimals: 0, maxLeverage: 3 },
  { name: 'NEIROETH', szDecimals: 0, maxLeverage: 5 },
  { name: 'IOTA', szDecimals: 0, maxLeverage: 3 },
  { name: 'FARTCOIN', szDecimals: 1, maxLeverage: 10 },
  { name: 'AI16Z', szDecimals: 1, maxLeverage: 5 },
  { name: 'AIXBT', szDecimals: 0, maxLeverage: 3 },
  { name: 'BIO', szDecimals: 0, maxLeverage: 3 },
  { name: 'kPEPE', szDecimals: 0, maxLeverage: 10 },
];

describe('readPerpMarketMeta — the market itself, never a neighbour', () => {
  const meta = { universe: SHORT_NAMES_FIRST } as never;

  // Chaque ligne est un marché que l'ancienne règle rattachait à un autre (valeurs `reçu` = celles du voisin).
  it.each([
    ['PEOPLE', 0, 3, 'OP'],
    ['MAVIA', 1, 3, 'MAV'],
    ['ETHFI', 1, 5, 'ETH'],
    ['HBAR', 0, 5, 'AR'],
    ['POPCAT', 0, 3, 'OP'],
    ['MEW', 0, 3, 'W'],
    ['NEIROETH', 0, 5, 'ETH'],
    ['IOTA', 0, 3, 'IO'],
    ['FARTCOIN', 1, 10, 'AR'],
    ['AI16Z', 1, 5, 'AI'],
    ['AIXBT', 0, 3, 'AI'],
    ['BIO', 0, 3, 'IO'],
  ])(
    '%s keeps its own grid (%i decimals, %ix), not that of %s',
    (name, szDecimals, maxLeverage) => {
      expect(readPerpMarketMeta(meta, name)).toEqual({ kind: 'perp', szDecimals, maxLeverage });
    },
  );

  it('reads the short names too: they are markets in their own right', () => {
    expect(readPerpMarketMeta(meta, 'ETH')).toEqual({
      kind: 'perp',
      szDecimals: 4,
      maxLeverage: 25,
    });
    expect(readPerpMarketMeta(meta, 'W')).toEqual({ kind: 'perp', szDecimals: 1, maxLeverage: 5 });
  });

  it('reads a HIP-3 market by its full prefixed name', () => {
    const hip3 = { universe: [{ name: 'xyz:MU', szDecimals: 3, maxLeverage: 10 }] } as never;

    expect(readPerpMarketMeta(hip3, 'xyz:MU')).toEqual({
      kind: 'perp',
      szDecimals: 3,
      maxLeverage: 10,
    });
  });

  // Le cas que la sous-chaîne rendait en silence : un nom qui n'existe pas mais en contient un qui existe.
  it.each(['ETHX', 'ETH-PERP', 'OPEN', 'XETH'])(
    'refuses %s, which only contains the name of another market',
    (name) => {
      expect(() => readPerpMarketMeta(meta, name)).toThrow(MarketMetaError);
      try {
        readPerpMarketMeta(meta, name);
      } catch (error) {
        expect((error as MarketMetaError).code).toBe('not-found');
      }
    },
  );

  // `normalizeCoin` met en majuscules : `kPEPE` devient `KPEPE`. L'égalité est exacte, la casse comprise :
  // un nom qui n'est pas celui de l'exchange n'est pas un marché, et se dit.
  it('refuses a name that differs only by its case: it is not the exchange name', () => {
    expect(() => readPerpMarketMeta(meta, 'KPEPE')).toThrow(/no perp market named "KPEPE"/);
    expect(readPerpMarketMeta(meta, 'kPEPE')).toMatchObject({ szDecimals: 0, maxLeverage: 10 });
  });

  it('refuses an empty universe, and says it found nothing', () => {
    expect(() => readPerpMarketMeta({ universe: [] } as never, 'BTC')).toThrow(
      /no perp market named "BTC"/,
    );
  });

  it('refuses two markets with the same name: choosing one would be a guess', () => {
    const twice = {
      universe: [
        { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
        { name: 'BTC', szDecimals: 4, maxLeverage: 20 },
      ],
    } as never;

    expect(() => readPerpMarketMeta(twice, 'BTC')).toThrow(/2 perp markets are named "BTC"/);
  });

  // `toFixed(undefined)` vaut `toFixed(0)` : une grille illisible ne doit jamais devenir une grille.
  it.each([
    ['a string', '4'],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['more than 8', 9],
    ['NaN', Number.NaN],
    ['undefined', undefined],
    ['null', null],
  ])('refuses a size grid that reads as %s', (_, szDecimals) => {
    const broken = { universe: [{ name: 'BTC', szDecimals, maxLeverage: 40 }] } as never;

    expect(() => readPerpMarketMeta(broken, 'BTC')).toThrow(/size decimals of "BTC"/);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['a string', '40'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
  ])('refuses a max leverage that reads as %s', (_, maxLeverage) => {
    const broken = { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage }] } as never;

    expect(() => readPerpMarketMeta(broken, 'BTC')).toThrow(/max leverage of "BTC"/);
  });

  it('accepts a grid of 0 decimals: whole units are a valid size step', () => {
    const whole = { universe: [{ name: 'PEOPLE', szDecimals: 0, maxLeverage: 3 }] } as never;

    expect(readPerpMarketMeta(whole, 'PEOPLE').szDecimals).toBe(0);
  });
});

/**
 * La forme de `spotMeta`, avec les `szDecimals` de jetons relevés le 2026-10-19 : USDC (index 0) 8,
 * PURR 0, HFUN 2, TRUMP 2. USDC est le PREMIER jeton, donc celui que la sous-chaîne rendait pour toute
 * paire cotée en USDC (317 des 334). Les index de paires non canoniques sont illustratifs.
 */
const SPOT_TOKENS = [
  { index: 0, name: 'USDC', szDecimals: 8 },
  { index: 1, name: 'PURR', szDecimals: 0 },
  { index: 2, name: 'HFUN', szDecimals: 2 },
  { index: 3, name: 'TRUMP', szDecimals: 2 },
];

const SPOT_META = {
  tokens: SPOT_TOKENS,
  universe: [
    { name: 'PURR/USDC', tokens: [1, 0], index: 0, isCanonical: true },
    { name: '@1', tokens: [2, 0], index: 1, isCanonical: false },
    { name: '@2', tokens: [3, 0], index: 2, isCanonical: false },
  ],
} as never;

describe('readSpotMarketMeta — the base token of the pair', () => {
  // La sous-chaîne rendait USDC (8 décimales) : la taille et le prix d'une paire cotée en USDC partaient
  // sur la grille du dollar.
  it.each([
    ['PURR/USDC', 0],
    ['@1', 2],
    ['@2', 2],
  ])(
    'reads %s on the grid of its base token (%i decimals), not on USDC (8)',
    (name, szDecimals) => {
      expect(readSpotMarketMeta(SPOT_META, name)).toEqual({ kind: 'spot', szDecimals });
    },
  );

  it('never returns the grid of the quote token for a pair quoted in it', () => {
    for (const pair of ['PURR/USDC', '@1', '@2']) {
      expect(readSpotMarketMeta(SPOT_META, pair).szDecimals).not.toBe(8);
    }
  });

  it('refuses a pair that does not exist', () => {
    expect(() => readSpotMarketMeta(SPOT_META, '@999')).toThrow(/no spot pair named "@999"/);
  });

  it('refuses a pair whose base token is missing from the token list', () => {
    const orphan = {
      tokens: [{ index: 0, name: 'USDC', szDecimals: 8 }],
      universe: [{ name: '@5', tokens: [77, 0], index: 5, isCanonical: false }],
    } as never;

    expect(() => readSpotMarketMeta(orphan, '@5')).toThrow(/base token \(index 77\)/);
  });

  it('refuses two pairs, or two tokens, that cannot be told apart', () => {
    const twoPairs = {
      tokens: SPOT_TOKENS,
      universe: [
        { name: '@1', tokens: [2, 0], index: 1 },
        { name: '@1', tokens: [3, 0], index: 1 },
      ],
    } as never;
    const twoTokens = {
      tokens: [
        { index: 2, name: 'A', szDecimals: 1 },
        { index: 2, name: 'B', szDecimals: 2 },
      ],
      universe: [{ name: '@1', tokens: [2, 0], index: 1 }],
    } as never;

    expect(() => readSpotMarketMeta(twoPairs, '@1')).toThrow(/2 spot pairs/);
    expect(() => readSpotMarketMeta(twoTokens, '@1')).toThrow(/2 tokens carry the index 2/);
  });

  it('refuses a base token whose size grid is unreadable', () => {
    const broken = {
      tokens: [{ index: 2, name: 'HFUN', szDecimals: '2' }],
      universe: [{ name: '@1', tokens: [2, 0], index: 1 }],
    } as never;

    expect(() => readSpotMarketMeta(broken, '@1')).toThrow(/size decimals of the token HFUN/);
  });

  it('carries a typed error whose code the form can act on', () => {
    try {
      readSpotMarketMeta(SPOT_META, '@999');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MarketMetaError);
      expect((error as MarketMetaError).code).toBe('not-found');
    }
  });
});
