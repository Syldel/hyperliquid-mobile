import { isSpotMarket, openOrdersDexOf } from './market-kind.util';

/**
 * Les noms viennent de la lecture publique du 2026-10-19 : 544 perps (`allPerpMetas`, 11 dex), 334 paires
 * spot (`spotMeta`) — `PURR/USDC` et 333 `@N` —, et de la doc « Asset IDs » (outcomes `#<encodage>`).
 */
describe('isSpotMarket', () => {
  // Le défaut mesuré : `includes('/')` ne reconnaissait que `PURR/USDC` sous le nom brut de l'exchange.
  it.each(['@1', '@107', '@142', '@333', 'PURR/USDC'])(
    'reads the raw spot name %s as a spot',
    (name) => {
      expect(isSpotMarket(name)).toBe(true);
    },
  );

  it.each(['HYPE/USDC', 'BTC/USDC', 'JEFF/USDC', 'HFUN/USDC'])(
    'reads the display name %s as a spot',
    (name) => {
      expect(isSpotMarket(name)).toBe(true);
    },
  );

  // La paire prime sur le préfixe de dex.
  it('lets the spot pair win over a dex-looking prefix', () => {
    expect(isSpotMarket('cash:XYZ/USDT')).toBe(true);
  });

  it.each(['BTC', 'ETH', 'kPEPE', '1000SHIB', 'AI16Z', 'xyz:MU', 'vntl:ROBOT', 'xyz:XYZ100'])(
    'does not read the perp %s as a spot',
    (name) => {
      expect(isSpotMarket(name)).toBe(false);
    },
  );

  // L'ancien `includes('-')` : aucun perp ni aucune paire spot réelle n'en porte (mesuré), et un perp
  // qui en porterait partait avec `isSpotAsset: true` dans son ordre.
  it.each(['BTC-PERP', 'xyz:TSLA-USDT', 'ABC-DEF'])(
    'does not read a hyphen as a spot mark: %s',
    (name) => {
      expect(isSpotMarket(name)).toBe(false);
    },
  );

  it.each(['', ':BTC', 'xyz:'])(
    'reads the name "%s", which no rule classifies, as not a spot',
    (name) => {
      expect(isSpotMarket(name)).toBe(false);
    },
  );
});

describe('openOrdersDexOf', () => {
  it('reads the main dex for a perp without a prefix', () => {
    expect(openOrdersDexOf('BTC')).toBe('');
  });

  it('reads the prefix for a builder-deployed perp', () => {
    expect(openOrdersDexOf('xyz:MU')).toBe('xyz');
    expect(openOrdersDexOf('vntl:ROBOT')).toBe('vntl');
  });

  // « Spot open orders are only included with the first perp dex » (doc Info endpoint, relue le
  // 2026-10-19) : un spot se lit avec le dex vide. Documenté, pas supposé.
  it.each(['@107', 'PURR/USDC', 'HYPE/USDC', 'cash:XYZ/USDT'])(
    'reads the main dex for the spot pair %s: spot orders are only returned there',
    (name) => {
      expect(openOrdersDexOf(name)).toBe('');
    },
  );

  // Le doute n'est pas une réponse : un nom non classé n'a pas de dex, et l'appelant refuse.
  it.each(['', ':BTC', 'xyz:'])('has no dex for "%s": the caller must refuse', (name) => {
    expect(openOrdersDexOf(name)).toBeNull();
  });
});
