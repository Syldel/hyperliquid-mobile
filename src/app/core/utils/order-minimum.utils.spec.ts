import type { HLOrderDetails } from '@syldel/hl-shared-types';
import { protectiveMinimumRefusal, triggerOrderValueUsd } from './order-minimum.utils';

function stop(input: {
  sz: string;
  triggerPx: string;
  limitPx: string;
  isMarket: boolean;
}): HLOrderDetails {
  return {
    assetName: 'ETH',
    isBuy: false,
    limitPx: input.limitPx,
    sz: input.sz,
    reduceOnly: true,
    orderType: { trigger: { isMarket: input.isMarket, triggerPx: input.triggerPx, tpsl: 'sl' } },
  };
}

describe('triggerOrderValueUsd', () => {
  it('values a market trigger at its trigger price, not at its 10 % bound', () => {
    // Le stop mesuré le 2026-11-13 : 0,005 × 1 972, borne 1 774,9.
    expect(
      triggerOrderValueUsd(
        stop({ sz: '0.005', triggerPx: '1972', limitPx: '1774.9', isMarket: true }),
      ),
    ).toBeCloseTo(9.86, 10);
  });

  it('values a limit trigger at its limit price, where it enters the book', () => {
    expect(
      triggerOrderValueUsd(
        stop({ sz: '0.005', triggerPx: '2100', limitPx: '1995', isMarket: false }),
      ),
    ).toBeCloseTo(9.975, 10);
  });

  it('has no trigger value for an ordinary limit order, or for unreadable numbers', () => {
    const limit: HLOrderDetails = {
      assetName: 'ETH',
      isBuy: true,
      limitPx: '1972',
      sz: '0.005',
      reduceOnly: false,
      orderType: { limit: { tif: 'Gtc' } },
    };
    expect(triggerOrderValueUsd(limit)).toBeNull();
    expect(
      triggerOrderValueUsd(stop({ sz: '0.005', triggerPx: '', limitPx: '1774.9', isMarket: true })),
    ).toBeNull();
  });
});

describe('protectiveMinimumRefusal', () => {
  // Mesuré le 2026-11-13 (603956585419) : accepté à la pose, `minTradeNtlRejected` au déclenchement.
  it('refuses a stop worth under 10 $ when it triggers, saying the exchange would accept it now', () => {
    expect(
      protectiveMinimumRefusal(
        stop({ sz: '0.005', triggerPx: '1972', limitPx: '1774.9', isMarket: true }),
      ),
    ).toBe(
      '≈ 9.86 $ when it triggers, under the 10 $ minimum: Hyperliquid accepts it now but refuses it when it triggers, and nothing is closed.',
    );
  });

  // Mesuré le 2026-11-12 (603229340180) : 10,01 $ au déclencheur, 9,01 $ à la borne, exécuté.
  it('lets a market stop through at 10 $ or more at its trigger, whatever its bound is worth', () => {
    expect(
      protectiveMinimumRefusal(
        stop({ sz: '0.00014', triggerPx: '71498', limitPx: '64349', isMarket: true }),
      ),
    ).toBeNull();
  });
});
