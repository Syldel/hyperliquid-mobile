import type { HLL2BookResponse, HLPerpMetaAndCtx } from '@syldel/hl-shared-types';
import { readMarketSnapshot } from './market-snapshot.util';

const BOOK: HLL2BookResponse = {
  coin: 'ETH',
  time: 1,
  levels: [[{ px: '2414.0', sz: '3', n: 2 }], [{ px: '2414.2', sz: '4', n: 3 }]],
};

/** La forme de `metaAndAssetCtxs` (`perpetuals.md`) : le contexte d'indice i est le marché i. */
const META_AND_CTX = [
  {
    universe: [
      { name: 'ETHFI', szDecimals: 1, maxLeverage: 5, marginTableId: 5 },
      { name: 'ETH', szDecimals: 4, maxLeverage: 25, marginTableId: 55 },
    ],
    marginTables: [],
  },
  [
    { markPx: '0.52', oraclePx: '0.52', dayNtlVlm: '100', funding: '0.0', midPx: '0.52' },
    {
      markPx: '2414.3',
      oraclePx: '2414.9',
      dayNtlVlm: '812345678.9',
      funding: '0.0000125',
      midPx: '2414.1',
    },
  ],
] as unknown as HLPerpMetaAndCtx;

describe('readMarketSnapshot', () => {
  it('reads the context of the market itself, by exact name: ETH, not ETHFI', () => {
    const reading = readMarketSnapshot('ETH', BOOK, META_AND_CTX, 1000);
    if (reading.status !== 'ok') throw new Error(reading.reason);
    expect(reading.snapshot.markPx).toBe(2414.3);
    expect(reading.snapshot.marginTableId).toBe(55);
    expect(reading.snapshot.mid).toBeCloseTo(2414.1, 9);
  });

  it('keeps the book usable but every context value unknown when the market is not in the meta', () => {
    const reading = readMarketSnapshot('SOL', { ...BOOK, coin: 'SOL' }, META_AND_CTX, 1000);
    if (reading.status !== 'ok') throw new Error(reading.reason);
    expect(reading.snapshot.markPx).toBeNull();
    expect(reading.snapshot.dayNtlVlm).toBeNull();
    expect(reading.snapshot.marginTableId).toBeNull();
  });

  it('is unavailable without a two-sided book: there is no mid to bound the order', () => {
    const oneSided = { ...BOOK, levels: [[], BOOK.levels[1]] } as unknown as HLL2BookResponse;
    expect(readMarketSnapshot('ETH', oneSided, META_AND_CTX, 1000).status).toBe('unavailable');
  });
});
