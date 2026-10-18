import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { isStuckTriggeredOrder } from './stuck-triggered-order.util';

/**
 * La forme est celle MESURÉE le 2026-10-18 (Stop Limit ETH, lu dans `frontendOpenOrders` 70
 * secondes après le déclenchement), recopiée à la main : si elle tombe, c'est que la
 * reconnaissance s'est écartée de ce que l'exchange rend.
 */
const MEASURED_ON_ETH: HLFrontendOpenOrder = {
  coin: 'ETH',
  side: 'A',
  limitPx: '2365.5',
  sz: '0.0044',
  oid: 578469475234,
  timestamp: 1792342452484,
  triggerCondition: 'Triggered',
  isTrigger: false,
  triggerPx: '0.0',
  isPositionTpsl: false,
  reduceOnly: true,
  orderType: 'Stop Limit',
  origSz: '0.0044',
  tif: 'Gtc',
  cloid: null,
};

describe('isStuckTriggeredOrder', () => {
  it('recognises the order measured on ETH after its trigger fired', () => {
    expect(isStuckTriggeredOrder(MEASURED_ON_ETH)).toBe(true);
  });

  it('does not take an armed stop for one: it still has to trigger', () => {
    const armed = { ...MEASURED_ON_ETH, isTrigger: true, triggerCondition: 'Price below 2365.5' };

    expect(isStuckTriggeredOrder(armed)).toBe(false);
  });

  it('does not take an ordinary limit order for one: it says N/A', () => {
    const ordinary = { ...MEASURED_ON_ETH, triggerCondition: 'N/A', orderType: 'Limit' };

    expect(isStuckTriggeredOrder(ordinary)).toBe(false);
  });

  it('needs reduce-only: an opening order that triggered is not a stop waiting to fill', () => {
    expect(isStuckTriggeredOrder({ ...MEASURED_ON_ETH, reduceOnly: false })).toBe(false);
  });

  it('is strict about isTrigger: a missing field is not read as false', () => {
    const withoutIsTrigger: Partial<HLFrontendOpenOrder> = { ...MEASURED_ON_ETH };
    delete withoutIsTrigger.isTrigger;

    expect(isStuckTriggeredOrder(withoutIsTrigger)).toBe(false);
  });
});
