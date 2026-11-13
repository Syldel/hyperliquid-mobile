import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import {
  closeSize,
  describeProtectiveAfterClose,
  partialCloseRefusal,
  protectiveOrdersOf,
} from './close-position.util';

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

  // Mesuré le 2026-11-12 : annulé à la milliseconde de la fermeture, trois fois.
  it('says a full close makes the exchange cancel it at once', () => {
    expect(describeProtectiveAfterClose(order({}), 0)).toBe(
      'nothing left to reduce: Hyperliquid cancels it at once (reduceOnlyCanceled)',
    );
  });

  // Mesuré le 2026-11-13 (oid 603932533273) : un TP/SL de position, taille 0, est annulé de même,
  // à la milliseconde de la fermeture. Il ne « suit » pas une position qui n'existe plus.
  it('says a full close cancels a position TP/SL at once too', () => {
    expect(describeProtectiveAfterClose(order({ isPositionTpsl: true, sz: '0.0' }), 0)).toBe(
      'nothing left to reduce: Hyperliquid cancels it at once (reduceOnlyCanceled)',
    );
  });
});

describe('partialCloseRefusal', () => {
  // La position mesurée le 2026-11-12 : 0,00015 BTC à ≈ 72 865.
  const position = { positionSz: 0.00015, markPx: 72865 };

  it('blocks a partial close under 10 $, and says what was measured', () => {
    expect(partialCloseRefusal({ ...position, closeSz: 0.00003 })).toBe(
      '≈ 2.19 $, under the 10 $ order minimum: Hyperliquid refuses a partial close below it, even reduce-only. Close more, or 100 %.',
    );
  });

  // Mesuré le 2026-11-12 : une position de 0,71 $ fermée à 100 % a été remplie.
  it('lets a full close through, even under 10 $: Hyperliquid accepts it', () => {
    expect(partialCloseRefusal({ positionSz: 0.0001, markPx: 72865, closeSz: 0.0001 })).toBeNull();
  });

  it('lets a partial close of 10 $ or more through', () => {
    expect(partialCloseRefusal({ positionSz: 0.001, markPx: 72865, closeSz: 0.0002 })).toBeNull();
  });

  it('says nothing without a price: the server decides', () => {
    expect(partialCloseRefusal({ ...position, closeSz: 0.00003, markPx: null })).toBeNull();
  });
});
