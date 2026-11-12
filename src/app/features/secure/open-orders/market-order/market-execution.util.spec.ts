import type { HLL2BookResponse } from '@syldel/hl-shared-types';
import {
  buildMarketOrder,
  isValidMaxSlippage,
  readBookTop,
  walkBook,
  worstPrice,
} from './market-execution.util';

/** Un carnet BTC à la forme d'`l2Book` : bids décroissants, asks croissants. */
function book(bids: Array<[string, string]>, asks: Array<[string, string]>): HLL2BookResponse {
  return {
    coin: 'BTC',
    time: 1_763_000_000_000,
    levels: [
      bids.map(([px, sz]) => ({ px, sz, n: 1 })),
      asks.map(([px, sz]) => ({ px, sz, n: 1 })),
    ],
  };
}

describe('readBookTop', () => {
  it('takes the mid between the best bid and the best ask, the allMids definition', () => {
    const top = readBookTop(book([['100000', '1']], [['100010', '1']]));
    expect(top).toEqual({ status: 'ok', bid: 100000, ask: 100010, mid: 100005 });
  });

  it('has no mid for a one-sided book, and does not take the other side alone', () => {
    const top = readBookTop(book([], [['100010', '1']]));
    expect(top.status).toBe('unavailable');
  });

  it('refuses a crossed book: its mid cannot be trusted', () => {
    expect(readBookTop(book([['100020', '1']], [['100010', '1']])).status).toBe('unavailable');
  });

  it('refuses an answer without two sides', () => {
    expect(readBookTop({ coin: 'BTC', time: 0, levels: [] } as never).status).toBe('unavailable');
    expect(readBookTop(null).status).toBe('unavailable');
  });
});

describe('worstPrice', () => {
  it('puts a buy above the mid by the max slippage, on the perp price grid', () => {
    // 100005 × 1,01 = 101005,05 → cinq chiffres significatifs.
    expect(worstPrice(100005, true, 1, 5)).toBe('101010');
  });

  it('puts a sell below the mid', () => {
    expect(worstPrice(100005, false, 1, 5)).toBe('99005');
  });

  it('keeps the decimals a small price needs', () => {
    // ETH-like : 2414,5 × 1,005 = 2426,5725 → 2426,6 (5 chiffres significatifs, 4 décimales permises).
    expect(worstPrice(2414.5, true, 0.5, 2)).toBe('2426.6');
  });
});

describe('isValidMaxSlippage', () => {
  it('accepts the bounds and refuses what is outside or not a number', () => {
    expect(isValidMaxSlippage(0.05)).toBe(true);
    expect(isValidMaxSlippage(10)).toBe(true);
    expect(isValidMaxSlippage(0.01)).toBe(false);
    expect(isValidMaxSlippage(10.5)).toBe(false);
    expect(isValidMaxSlippage(NaN)).toBe(false);
  });
});

describe('walkBook', () => {
  const asks = book(
    [['99990', '1']],
    [
      ['100010', '0.001'],
      ['100020', '0.002'],
      ['100500', '5'],
    ],
  );

  it('averages the levels a buy consumes', () => {
    const walk = walkBook(asks, true, 0.002, 101000);
    // 0,001 × 100010 + 0,001 × 100020 = 200,03 → 100015.
    expect(walk.fillableSz).toBe(0.002);
    expect(walk.avgPx).toBeCloseTo(100015, 6);
    expect(walk.depthExhausted).toBe(false);
  });

  it('stops at the worst price: what lies beyond would not be filled by the IOC', () => {
    const walk = walkBook(asks, true, 1, 100100);
    expect(walk.fillableSz).toBeCloseTo(0.003, 12);
    expect(walk.depthExhausted).toBe(false);
  });

  it('says the visible book ran out when neither the size nor the bound was reached', () => {
    // 5,003 visibles, sous un plafond très large : au-delà des 20 niveaux, rien n'est connu.
    const walk = walkBook(asks, true, 10, 200000);
    expect(walk.depthExhausted).toBe(true);
    expect(walk.fillableSz).toBeCloseTo(5.003, 9);
  });

  it('consumes the bids for a sell, down to the floor', () => {
    const bids = book(
      [
        ['99990', '0.001'],
        ['99900', '1'],
      ],
      [['100010', '1']],
    );
    expect(walkBook(bids, false, 0.002, 99950).fillableSz).toBeCloseTo(0.001, 12);
  });

  it('has no average price when nothing is fillable within the bound', () => {
    const walk = walkBook(asks, true, 0.001, 100000);
    expect(walk.avgPx).toBeNull();
    expect(walk.fillableSz).toBe(0);
  });
});

describe('buildMarketOrder', () => {
  it('sends one IOC at the worst price, with the reduce-only flag given', () => {
    expect(
      buildMarketOrder({
        assetName: 'BTC',
        isBuy: false,
        sz: '0.00011',
        worstPx: '99005',
        reduceOnly: true,
      }),
    ).toEqual({
      assetName: 'BTC',
      isBuy: false,
      limitPx: '99005',
      sz: '0.00011',
      reduceOnly: true,
      orderType: { limit: { tif: 'Ioc' } },
    });
  });
});
