import {
  buildProtectiveOrderDetails,
  computeProtectiveTriggerPx,
  type MainOrderContext,
  type ProtectiveOrderParams,
} from './protective-order.utils';

/**
 * La modale « Add protective order » : un SL ou un TP attaché à un ordre principal, dont le
 * déclencheur se compte en % du prix d'entrée.
 *
 * Ce que ces tests épinglent, c'est le PRIX LIMITE de l'ordre de clôture. Il valait 0,1 % du
 * déclencheur quel que soit le type, « Market execution » comprise (relevé le 2026-10-18) — sans
 * effet au marché, où l'exchange ignore `p`, mais un plancher trop serré pour une exécution
 * limite. Il suit désormais `limit-spread.util.ts` : au marché, la borne que l'exchange calcule
 * lui-même (déclencheur × 0,9 / × 1,1, arrondi comme lui) ; en exécution limite, 5 % pour un SL
 * et 1,5 % pour un TP — sous le déclencheur pour une vente, au-dessus pour un achat. Les attendus
 * sont calculés à la main, pas relus des constantes.
 */
const LONG: MainOrderContext = {
  assetName: 'BTC',
  isBuy: true,
  limitPx: '82120',
  sz: '0.00014',
  szDecimals: 5,
  isSpot: false,
};
const SHORT: MainOrderContext = { ...LONG, isBuy: false };

const protective = (overrides: Partial<ProtectiveOrderParams>): ProtectiveOrderParams => ({
  kind: 'sl',
  sizePercent: 100,
  priceOffsetPercent: 5,
  isMarket: true,
  ...overrides,
});

describe('computeProtectiveTriggerPx', () => {
  it('puts the stop of a long under the entry, and its take profit over it', () => {
    expect(computeProtectiveTriggerPx(LONG, protective({ kind: 'sl' }))).toBe('78014');
    expect(
      computeProtectiveTriggerPx(LONG, protective({ kind: 'tp', priceOffsetPercent: 3 })),
    ).toBe('84584');
  });

  it('inverts both for a short', () => {
    expect(computeProtectiveTriggerPx(SHORT, protective({ kind: 'sl' }))).toBe('86226');
  });

  it('has no trigger without an entry price', () => {
    expect(computeProtectiveTriggerPx({ ...LONG, limitPx: '' }, protective({}))).toBe('');
  });
});

describe('buildProtectiveOrderDetails — the limit price of the closing order', () => {
  it('sits 10 % under the trigger of a market stop that closes a long', () => {
    const order = buildProtectiveOrderDetails(LONG, protective({ kind: 'sl', isMarket: true }));

    // 82120 × 0,95 = 78014 ; × 0,9 = 70212,6 → 5 chiffres significatifs.
    expect(order.orderType).toEqual({
      trigger: { isMarket: true, triggerPx: '78014', tpsl: 'sl' },
    });
    expect(order.limitPx).toBe('70213');
    expect(order.isBuy).toBe(false);
  });

  it('sits 10 % over the trigger of a market stop that closes a short', () => {
    const order = buildProtectiveOrderDetails(SHORT, protective({ kind: 'sl', isMarket: true }));

    // 82120 × 1,05 = 86226 ; × 1,1 = 94848,6 ; un achat est tronqué.
    expect(order.limitPx).toBe('94848');
    expect(order.isBuy).toBe(true);
  });

  it('gives a market take profit the same 10 % spread', () => {
    const order = buildProtectiveOrderDetails(
      LONG,
      protective({ kind: 'tp', priceOffsetPercent: 3, isMarket: true }),
    );

    // 82120 × 1,03 = 84583,6 → 84584 ; × 0,9 = 76125,6.
    expect(order.limitPx).toBe('76126');
  });

  it('keeps a limit stop 5 % from its trigger: wide enough to exit', () => {
    const order = buildProtectiveOrderDetails(LONG, protective({ kind: 'sl', isMarket: false }));

    // 78014 × 0,95 = 74113,3.
    expect(order.limitPx).toBe('74113');
  });

  it('keeps a limit take profit 1.5 % from its trigger: it holds the target price', () => {
    const order = buildProtectiveOrderDetails(
      LONG,
      protective({ kind: 'tp', priceOffsetPercent: 3, isMarket: false }),
    );

    // 84584 × 0,985 = 83315,24.
    expect(order.limitPx).toBe('83315');
  });

  it('never leaves the limit equal to, or 0.1 % from, the trigger of a market order', () => {
    // L'écart d'avant le 2026-10-18 : un SL « au marché » avec un limite à 0,1 % du déclencheur.
    const order = buildProtectiveOrderDetails(LONG, protective({ kind: 'sl', isMarket: true }));
    const trigger = Number(computeProtectiveTriggerPx(LONG, protective({ kind: 'sl' })));

    expect(Math.abs(Number(order.limitPx) - trigger) / trigger).toBeGreaterThan(0.05);
  });
});

describe('buildProtectiveOrderDetails — the rest of the order', () => {
  it('closes the position: reduce only, the opposite side, a share of its size', () => {
    const order = buildProtectiveOrderDetails(LONG, protective({ sizePercent: 50 }));

    expect(order.reduceOnly).toBe(true);
    expect(order.assetName).toBe('BTC');
    expect(order.sz).toBe('0.00007');
  });
});
