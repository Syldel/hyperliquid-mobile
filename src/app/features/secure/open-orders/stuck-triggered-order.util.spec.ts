import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import {
  describeStuckTriggered,
  isStuckTriggeredOrder,
  stuckTriggeredFill,
} from './stuck-triggered-order.util';

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

/**
 * Un ordre limite peut être exécuté en partie : `sz` est alors la part restante et `origSz` la
 * taille posée. ⚠️ Les ordres restés mesurés le 2026-10-18 étaient entiers ; cette forme-ci est lue
 * du type, pas d'une mesure. Les tailles ci-dessous sont calculées à la main.
 */
describe('stuckTriggeredFill', () => {
  it('is null for a whole order: nothing was executed', () => {
    expect(stuckTriggeredFill(MEASURED_ON_ETH)).toBeNull();
  });

  it('says what is left and what is filled, exactly', () => {
    expect(stuckTriggeredFill({ sz: '0.6', origSz: '1.5' })).toEqual({
      orig: '1.5',
      filled: '0.9',
      left: '0.6',
    });
  });

  it('is exact where floats are not: 0.3 − 0.1 is 0.2, not 0.19999999999999998', () => {
    expect(stuckTriggeredFill({ sz: '0.1', origSz: '0.3' })?.filled).toBe('0.2');
  });

  it('subtracts across different digit counts, and keeps the integer part', () => {
    expect(stuckTriggeredFill({ sz: '0.0030', origSz: '0.0044' })?.filled).toBe('0.0014');
    expect(stuckTriggeredFill({ sz: '9.5', origSz: '10' })?.filled).toBe('0.5');
    expect(stuckTriggeredFill({ sz: '0', origSz: '10' })?.filled).toBe('10');
  });

  it('treats the same value written two ways as a whole order', () => {
    expect(stuckTriggeredFill({ sz: '0.0044', origSz: '0.00440' })).toBeNull();
  });

  // Se contredire n'est pas une exécution : on ne devine rien, on décrit l'ordre tel que reçu.
  it.each([
    ['sz larger than origSz', { sz: '2', origSz: '1' }],
    ['an unreadable size', { sz: 'n/a', origSz: '1' }],
    ['a negative size', { sz: '-1', origSz: '1' }],
    ['an exponent', { sz: '1e-3', origSz: '1' }],
    ['an empty size', { sz: '', origSz: '1' }],
  ])('is null on %s: no execution is guessed', (_, order) => {
    expect(stuckTriggeredFill(order)).toBeNull();
  });
});

describe('describeStuckTriggered', () => {
  const whole = { sz: '0.0044', origSz: '0.0044', limitPx: '2365.5' };
  const partly = { sz: '0.6', origSz: '1.5', limitPx: '2365.5' };

  it('keeps the wording measured so far for a whole order (list)', () => {
    expect(describeStuckTriggered(whole)).toBe(
      'Triggered, but this order is still resting unfilled: the position is not protected by it.',
    );
  });

  it('keeps the wording for a whole order in the detail: its limit, and when it fills', () => {
    expect(describeStuckTriggered(whole, true)).toBe(
      'Triggered, but this order is still resting unfilled at 2365.5: the position is not protected by it. It fills only if the price comes back to that limit.',
    );
  });

  it('never says "unfilled" about an order that was partly executed (list)', () => {
    const text = describeStuckTriggered(partly);

    expect(text).toBe(
      'Triggered, 0.9 of 1.5 already filled, but 0.6 is still resting: the position is not protected by it.',
    );
    expect(text).not.toContain('unfilled');
  });

  it('says what is left and where it rests for an order partly executed (detail)', () => {
    expect(describeStuckTriggered(partly, true)).toBe(
      'Triggered, 0.9 of 1.5 already filled, but 0.6 is still resting at 2365.5: the position is not protected by it. The rest fills only if the price comes back to that limit.',
    );
  });
});
