import {
  crossingCloseLimitWarning,
  marginShortfallWarning,
  openingSize,
  positionEffect,
  WIDE_SLIPPAGE_PCT,
  wideSlippageWarning,
} from './order-guards.util';

describe('crossingCloseLimitWarning', () => {
  const closeLong = {
    orderKind: 'limit',
    reduceOnly: true,
    isBuy: false,
    currentPrice: 73000,
  };

  it('warns when a closing sell sits below the market: it fills at once, as a taker', () => {
    expect(crossingCloseLimitWarning({ ...closeLong, limitPx: '72000' })).toContain(
      'fills now, as a taker, down to 72000',
    );
  });

  it('warns when a closing buy sits above the market', () => {
    expect(crossingCloseLimitWarning({ ...closeLong, isBuy: true, limitPx: '74000' })).toContain(
      'up to 74000',
    );
  });

  it('says nothing for a closing limit that waits on the right side', () => {
    expect(crossingCloseLimitWarning({ ...closeLong, limitPx: '74000' })).toBeNull();
  });

  // Égal au mid : le croisement réel dépend du carnet, pas du mid.
  it('says nothing at the market price itself', () => {
    expect(crossingCloseLimitWarning({ ...closeLong, limitPx: '73000' })).toBeNull();
  });

  // Un limite qui croise sans reduce-only est déjà BLOQUÉ par `isPriceInvalid`.
  it('leaves non-reduce-only and non-limit orders to the other checks', () => {
    expect(
      crossingCloseLimitWarning({ ...closeLong, reduceOnly: false, limitPx: '72000' }),
    ).toBeNull();
    expect(
      crossingCloseLimitWarning({ ...closeLong, orderKind: 'trigger', limitPx: '72000' }),
    ).toBeNull();
  });

  it('says nothing without a market price or a readable limit', () => {
    expect(
      crossingCloseLimitWarning({ ...closeLong, currentPrice: null, limitPx: '72000' }),
    ).toBeNull();
    expect(crossingCloseLimitWarning({ ...closeLong, limitPx: '' })).toBeNull();
  });
});

describe('positionEffect', () => {
  const long = { isBuy: true, sz: 0.00015 };

  it('says nothing without a position, or for an order on the same side', () => {
    expect(positionEffect({ position: null, isBuy: false, sz: 1, reduceOnly: false })).toBeNull();
    expect(positionEffect({ position: long, isBuy: true, sz: 1, reduceOnly: false })).toBeNull();
  });

  it('says nothing for a reduce-only order: it cannot flip', () => {
    expect(
      positionEffect({ position: long, isBuy: false, sz: 0.001, reduceOnly: true }),
    ).toBeNull();
  });

  it('tells how much an opposite order leaves of the position', () => {
    expect(positionEffect({ position: long, isBuy: false, sz: 0.0001, reduceOnly: false })).toEqual(
      {
        kind: 'reduces',
        text: 'Reduces your long 0.00015 to 0.00005.',
      },
    );
  });

  it('tells an opposite order of the same size closes it', () => {
    expect(
      positionEffect({ position: long, isBuy: false, sz: 0.00015, reduceOnly: false })?.kind,
    ).toBe('closes');
  });

  // Le cas visé : « Sell » tapé pour fermer, avec une taille de trop.
  it('warns that a larger opposite order flips the position', () => {
    expect(positionEffect({ position: long, isBuy: false, sz: 0.0003, reduceOnly: false })).toEqual(
      {
        kind: 'flips',
        text: "Closes your long 0.00015 AND opens a short 0.00015. To close only, use the position's Close buttons.",
      },
    );
  });

  it('speaks in buy / sell on a spot-like market', () => {
    expect(
      positionEffect({
        position: long,
        isBuy: false,
        sz: 0.0001,
        reduceOnly: false,
        usesBuySell: true,
      })?.text,
    ).toBe('Reduces your buy 0.00015 to 0.00005.');
  });
});

describe('openingSize', () => {
  const long = { isBuy: true, sz: 0.0002 };

  it('counts the whole size without a position or on its side', () => {
    expect(openingSize({ position: null, isBuy: true, sz: 0.001, reduceOnly: false })).toBe(0.001);
    expect(openingSize({ position: long, isBuy: true, sz: 0.001, reduceOnly: false })).toBe(0.001);
  });

  it('counts only the excess that flips an opposite position', () => {
    expect(
      openingSize({ position: long, isBuy: false, sz: 0.0005, reduceOnly: false }),
    ).toBeCloseTo(0.0003, 12);
    expect(openingSize({ position: long, isBuy: false, sz: 0.0001, reduceOnly: false })).toBe(0);
  });

  it('counts nothing for a reduce-only order', () => {
    expect(openingSize({ position: null, isBuy: true, sz: 0.001, reduceOnly: true })).toBe(0);
  });
});

describe('marginShortfallWarning', () => {
  it('warns when the margin at this leverage exceeds the available capital', () => {
    // 0,001 × 73 000 / 3 = 24,33 $ pour 3,65 $.
    expect(
      marginShortfallWarning({ openingSz: 0.001, price: 73000, leverage: 3, available: 3.65 }),
    ).toBe('Needs ≈ 24.33 $ of margin at 3x, 3.65 $ available: Hyperliquid will likely refuse it.');
  });

  it('says nothing when the capital covers it', () => {
    // 0,00015 × 73 000 / 3 = 3,65 $ : tout juste couvert.
    expect(
      marginShortfallWarning({ openingSz: 0.00015, price: 73000, leverage: 3, available: 3.65 }),
    ).toBeNull();
  });

  // Mesuré le 2026-11-12 : short ETH 0,0343 à 3x, tout le capital engagé ; acheter 0,05 rachète le
  // short (≈ 23 $ de marge libérés) avant d'ouvrir 0,0157 (≈ 10,6 $).
  it('counts the margin freed by the position the order closes first', () => {
    expect(
      marginShortfallWarning({
        openingSz: 0.0157,
        freedSz: 0.0343,
        price: 2018,
        leverage: 3,
        available: 0,
      }),
    ).toBeNull();
  });

  it('names the freed margin when even with it the capital falls short', () => {
    expect(
      marginShortfallWarning({
        openingSz: 0.1,
        freedSz: 0.01,
        price: 2000,
        leverage: 2,
        available: 1,
      }),
    ).toBe(
      'Needs ≈ 100.00 $ of margin at 2x, 11.00 $ available (with 10.00 $ freed by the close): Hyperliquid will likely refuse it.',
    );
  });

  it('says nothing when it opens nothing, or when a figure is unknown', () => {
    const base = { openingSz: 0.001, price: 73000, leverage: 3, available: 3.65 };
    expect(marginShortfallWarning({ ...base, openingSz: 0 })).toBeNull();
    expect(marginShortfallWarning({ ...base, price: null })).toBeNull();
    expect(marginShortfallWarning({ ...base, leverage: null })).toBeNull();
    expect(marginShortfallWarning({ ...base, available: null })).toBeNull();
  });
});

describe('wideSlippageWarning', () => {
  it('says nothing up to the threshold', () => {
    expect(WIDE_SLIPPAGE_PCT).toBe(3);
    expect(wideSlippageWarning(1)).toBeNull();
    expect(wideSlippageWarning(3)).toBeNull();
  });

  it('warns beyond it', () => {
    expect(wideSlippageWarning(5)).toContain('up to 5 % away from the mid');
  });

  // Une saisie illisible est déjà refusée par `isValidMaxSlippage`.
  it('says nothing for an unreadable value', () => {
    expect(wideSlippageWarning(Number.NaN)).toBeNull();
  });
});
