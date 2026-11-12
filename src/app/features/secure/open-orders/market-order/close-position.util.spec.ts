import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { closeSize, describeProtectiveAfterClose, protectiveOrdersOf } from './close-position.util';

function order(overrides: Partial<HLFrontendOpenOrder>): HLFrontendOpenOrder {
  return {
    coin: 'BTC',
    side: 'A',
    limitPx: '90000.0',
    sz: '0.00011',
    oid: 1,
    timestamp: 0,
    triggerCondition: 'Price below 91000',
    isTrigger: true,
    triggerPx: '91000.0',
    children: [],
    isPositionTpsl: false,
    reduceOnly: true,
    orderType: 'Stop Market',
    origSz: '0.00011',
    tif: null,
    cloid: null,
    ...overrides,
  } as HLFrontendOpenOrder;
}

describe('closeSize', () => {
  it('closes the exact position at 100 %, short or long', () => {
    expect(closeSize('-0.00011', 100, 5)).toBe('0.00011');
    expect(closeSize('0.00011', 100, 5)).toBe('0.00011');
  });

  it('rounds a share down on the size grid: never more than the position', () => {
    // 0,00011 × 25 % = 0,0000275 → 0,00002.
    expect(closeSize('0.00011', 25, 5)).toBe('0.00002');
    expect(closeSize('0.00011', 50, 5)).toBe('0.00005');
  });

  it('gives nothing for an empty position or a null share', () => {
    expect(closeSize('0', 100, 5)).toBe('');
    expect(closeSize('0.1', 0, 5)).toBe('');
  });
});

describe('protectiveOrdersOf', () => {
  it('keeps the reduce-only triggers of the coin only', () => {
    const orders = [
      order({ oid: 1 }),
      order({ oid: 2, coin: 'ETH' }),
      order({ oid: 3, isTrigger: false }),
      order({ oid: 4, reduceOnly: false }),
    ];
    expect(protectiveOrdersOf(orders, 'BTC').map((o) => o.oid)).toEqual([1]);
  });
});

describe('describeProtectiveAfterClose', () => {
  it('says a fixed-size stop keeps a size larger than what remains after a partial close', () => {
    expect(describeProtectiveAfterClose(order({ sz: '0.00011' }), 0.00005)).toBe(
      'keeps its size 0.00011, larger than the 0.00005 left',
    );
  });

  it('says a position TP/SL follows the position', () => {
    expect(describeProtectiveAfterClose(order({ isPositionTpsl: true, sz: '0.0' }), 0.00005)).toBe(
      'follows the position: it will close what remains',
    );
  });

  it('says a full close leaves the exchange to cancel it', () => {
    expect(describeProtectiveAfterClose(order({}), 0)).toContain('reduceOnlyCanceled');
  });
});
