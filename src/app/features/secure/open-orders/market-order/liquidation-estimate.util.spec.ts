import type { HLPerpMarginTableEntry } from '@syldel/hl-shared-types';
import { estimateLiquidation, type LiquidationInput } from './liquidation-estimate.util';

/** Un long BTC isolé, 10x, sans position, table 40 (un seul palier, levier max 40). */
function isolatedLong(overrides: Partial<LiquidationInput> = {}): LiquidationInput {
  return {
    reduceOnly: false,
    isBuy: true,
    sz: 0.001,
    entryPx: 100000,
    markPx: 100000,
    leverage: { type: 'isolated', value: 10 },
    hasPosition: false,
    marginTableId: 40,
    marginTables: [],
    ...overrides,
  };
}

describe('estimateLiquidation', () => {
  it('applies the documented formula to an isolated long', () => {
    // l = 1/80 ; marge 10 ; maintenance 1,25 ; liq = 100000 − 8,75 / 0,001 / 0,9875.
    const estimate = estimateLiquidation(isolatedLong());
    expect(estimate.status).toBe('estimated');
    expect(estimate.status === 'estimated' && estimate.px).toBeCloseTo(91139.24, 2);
  });

  it('puts the liquidation of an isolated short above the entry', () => {
    // liq = 100000 + 8,75 / 0,001 / 1,0125.
    const estimate = estimateLiquidation(isolatedLong({ isBuy: false }));
    expect(estimate.status === 'estimated' && estimate.px).toBeCloseTo(108641.98, 2);
  });

  it('is the price where the isolated equity meets the maintenance at that price', () => {
    // La formule de la doc, vérifiée par sa définition : marge + PnL au prix de liquidation =
    // maintenance au même prix.
    const estimate = estimateLiquidation(
      isolatedLong({ leverage: { type: 'isolated', value: 5 } }),
    );
    if (estimate.status !== 'estimated') throw new Error('expected an estimate');
    const equity = 20 + 0.001 * (estimate.px - 100000);
    expect(equity).toBeCloseTo((1 / 80) * 0.001 * estimate.px, 9);
  });

  it('is not estimated in cross margin, and says why', () => {
    const estimate = estimateLiquidation(isolatedLong({ leverage: { type: 'cross', value: 10 } }));
    expect(estimate).toEqual({
      status: 'not-estimated',
      reason: 'cross margin: it depends on the whole account',
    });
  });

  it('is not estimated when the order adds to an open position, or when that is unknown', () => {
    expect(estimateLiquidation(isolatedLong({ hasPosition: true })).status).toBe('not-estimated');
    expect(estimateLiquidation(isolatedLong({ hasPosition: null })).status).toBe('not-estimated');
  });

  it('is not estimated for a reduce-only order', () => {
    expect(estimateLiquidation(isolatedLong({ reduceOnly: true })).status).toBe('not-estimated');
  });

  it('reads the first tier of a tiered table, and refuses a notional above it', () => {
    const tables: HLPerpMarginTableEntry[] = [
      [
        56,
        {
          description: 'tiered',
          marginTiers: [
            { lowerBound: '0.0', maxLeverage: 40 },
            { lowerBound: '150000000.0', maxLeverage: 20 },
          ],
        },
      ],
    ];
    const small = estimateLiquidation(isolatedLong({ marginTableId: 56, marginTables: tables }));
    expect(small.status === 'estimated' && small.px).toBeCloseTo(91139.24, 2);

    const huge = estimateLiquidation(
      isolatedLong({ marginTableId: 56, marginTables: tables, sz: 2000 }),
    );
    expect(huge).toEqual({
      status: 'not-estimated',
      reason: 'the position would be above the first margin tier',
    });
  });

  it('says a table missing from the meta, instead of assuming a leverage', () => {
    const estimate = estimateLiquidation(isolatedLong({ marginTableId: 56, marginTables: [] }));
    expect(estimate.status).toBe('not-estimated');
  });

  it('says there is no liquidation price when the margin covers a fall to zero', () => {
    const estimate = estimateLiquidation(
      isolatedLong({ leverage: { type: 'isolated', value: 1 } }),
    );
    expect(estimate.status).toBe('none');
  });
});
