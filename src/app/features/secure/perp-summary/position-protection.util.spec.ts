import type { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import type { IExchange } from '@syldel/trading-shared-types';
import { botManagedPairs, positionProtection, type Coverage } from './position-protection.util';

/**
 * Les formes viennent d'ordres lus sur le compte de développement : le stop du bot
 * (`Price below 2365.5`), le stop déclenché resté au carnet (2026-10-18), les trailing stops S1
 * (en suivi) et S2 (en attente) de la sonde du 2026-11-17. Les tailles et les prix sont ceux d'un
 * long ETH de 0,0065.
 */
const STOP: HLFrontendOpenOrder = {
  coin: 'ETH',
  side: 'A',
  limitPx: '1609.74',
  sz: '0.0065',
  oid: 1,
  timestamp: 1_763_300_000_000,
  isPositionTpsl: false,
  isTrigger: true,
  orderType: 'Stop Market',
  origSz: '0.0065',
  reduceOnly: true,
  triggerCondition: 'Price below 1788.6',
  triggerPx: '1788.6',
  tif: null,
  cloid: null,
};

const TRAILING_TRACKING: HLFrontendOpenOrder = {
  ...STOP,
  oid: 2,
  orderType: 'Trailing Stop Market',
  triggerCondition: 'Activation immediate, retracement 10%, best 1811.5',
  triggerPx: '1630.35',
};

const TRAILING_WAITING: HLFrontendOpenOrder = {
  ...STOP,
  oid: 3,
  orderType: 'Trailing Stop Market',
  triggerCondition: 'Activation above 2355, retracement 275, best waiting',
  triggerPx: '0.0',
};

const STUCK_STOP: HLFrontendOpenOrder = {
  ...STOP,
  oid: 4,
  orderType: 'Stop Limit',
  isTrigger: false,
  triggerCondition: 'Triggered',
  triggerPx: '0.0',
  tif: 'Gtc',
};

const TAKE_PROFIT: HLFrontendOpenOrder = {
  ...STOP,
  oid: 5,
  orderType: 'Take Profit Market',
  triggerCondition: 'Price above 2100',
  triggerPx: '2100',
};

const LONG = { coin: 'ETH', szi: '0.0065' };
const SHORT = { coin: 'ETH', szi: '-0.0065' };

const read = (position: typeof LONG, orders: HLFrontendOpenOrder[]) => {
  const result = positionProtection(position, orders);
  if (result.verdict !== 'read') throw new Error(`expected a reading, got ${result.reason}`);
  return result;
};
const slOf = (orders: HLFrontendOpenOrder[], position = LONG): Coverage =>
  read(position, orders).sl;
const tpOf = (orders: HLFrontendOpenOrder[], position = LONG): Coverage =>
  read(position, orders).tp;

describe('positionProtection', () => {
  describe('the stop-loss', () => {
    it('is full with a stop of the position size, on the closing side', () => {
      expect(slOf([STOP])).toEqual({
        state: 'full',
        nearest: { kind: 'SL', px: '1788.6', oid: 1 },
        covers: [{ kind: 'SL', px: '1788.6', oid: 1 }],
      });
    });

    it('adds stop sizes to the last digit', () => {
      const halves = [
        { ...STOP, sz: '0.0032' },
        { ...STOP, oid: 9, sz: '0.0033', triggerPx: '1750', triggerCondition: 'Price below 1750' },
      ];
      expect(slOf(halves).state).toBe('full');
    });

    // Un ordre reduce-only est plafonné à la position : plus gros, il couvre.
    it('is full with a stop larger than the position', () => {
      expect(slOf([{ ...STOP, sz: '0.01' }]).state).toBe('full');
    });

    it('is partial with a smaller stop, rounded down', () => {
      expect(slOf([{ ...STOP, sz: '0.0064' }])).toMatchObject({ state: 'partial', pct: 98 });
    });

    // S6, 2026-11-17 : le stop appliqué est le triggerPx de cette liste, qui suit le watermark.
    it('counts a native trailing stop that is tracking, at its live stop', () => {
      expect(slOf([TRAILING_TRACKING])).toMatchObject({
        state: 'full',
        nearest: { kind: 'TS', px: '1630.35' },
      });
    });

    it('names the stop the price reaches first: the highest for a long', () => {
      const sl = slOf([TRAILING_TRACKING, STOP]);
      expect(sl.state === 'full' && sl.nearest.oid).toBe(1);
    });

    it('names the lowest for a short', () => {
      const buyStop = (oid: number, px: string) => ({
        ...STOP,
        oid,
        side: 'B' as const,
        triggerPx: px,
        triggerCondition: `Price above ${px}`,
      });
      expect(slOf([buyStop(1, '2000'), buyStop(2, '1900')], SHORT)).toMatchObject({
        state: 'full',
        nearest: { px: '1900' },
      });
    });

    // Un stop de position (taille écrite 0.0) a fermé en réel une position agrandie (2026-10-26).
    it('is full with a position stop written with size 0.0', () => {
      expect(slOf([{ ...STOP, sz: '0.0', isPositionTpsl: true }])).toMatchObject({
        state: 'full',
        nearest: { kind: 'Position SL' },
      });
    });

    it('is none with no order, or with only a take-profit', () => {
      expect(slOf([])).toEqual({ state: 'none' });
      expect(slOf([TAKE_PROFIT])).toEqual({ state: 'none' });
    });

    it('ignores a stop on the opening side, not reduce-only, or on another coin', () => {
      const ignored = [
        { ...STOP, side: 'B' as const },
        { ...STOP, reduceOnly: false },
        { ...STOP, coin: 'BTC' },
      ];
      expect(slOf(ignored)).toEqual({ state: 'none' });
    });

    it('ignores an order type it does not know, rather than guessing', () => {
      expect(slOf([{ ...STOP, orderType: 'Stop Something' }])).toEqual({ state: 'none' });
    });
  });

  describe('the take-profit', () => {
    it('is full with a take-profit of the position size, above the price of a long', () => {
      expect(tpOf([TAKE_PROFIT])).toMatchObject({
        state: 'full',
        nearest: { kind: 'TP', px: '2100' },
      });
    });

    it('names the take-profit the price reaches first: the lowest for a long', () => {
      const ladder = [
        { ...TAKE_PROFIT, sz: '0.003' },
        {
          ...TAKE_PROFIT,
          oid: 6,
          sz: '0.003',
          triggerPx: '1950',
          triggerCondition: 'Price above 1950',
        },
      ];
      expect(tpOf(ladder)).toMatchObject({ state: 'partial', pct: 92, nearest: { px: '1950' } });
    });

    it('is below the price for a short', () => {
      const buyTp = { ...TAKE_PROFIT, side: 'B' as const, triggerCondition: 'Price below 1500' };
      expect(tpOf([buyTp], SHORT).state).toBe('full');
    });

    it('never counts a stop, nor a trailing stop', () => {
      expect(tpOf([STOP, TRAILING_TRACKING])).toEqual({ state: 'none' });
    });
  });

  describe('the notes, a few words each', () => {
    // 2026-10-18 : un Stop Limit déclenché est resté 826 s au carnet, la position nue.
    it('says a triggered stop still resting does not count, and that it alters the reading', () => {
      const result = read(LONG, [STUCK_STOP]);
      expect(result.sl).toEqual({ state: 'none' });
      expect(result.notes).toEqual([{ text: 'SL triggered, still resting', alters: true }]);
    });

    it('names a triggered take-profit by its role', () => {
      const stuckTp = { ...STUCK_STOP, orderType: 'Take Profit Limit' };
      expect(read(LONG, [stuckTp]).notes[0]?.text).toBe('TP triggered, still resting');
    });

    it('says what a waiting trailing stop waits for, without counting it', () => {
      const result = read(LONG, [TRAILING_WAITING]);
      expect(result.sl).toEqual({ state: 'none' });
      expect(result.notes).toEqual([{ text: 'Trailing waits > 2355', alters: false }]);
    });

    // Le nom et le sens du seuil doivent s'accorder : sinon l'ordre ne se devine pas.
    it('says an order whose trigger direction contradicts its role is not counted', () => {
      const result = read(LONG, [{ ...STOP, triggerCondition: 'Price above 1788.6' }]);
      expect(result.sl).toEqual({ state: 'none' });
      expect(result.notes[0]?.text).toBe('SL "Price above 1788.6" not counted');
    });

    it('says a size that is zero or unreadable is not counted', () => {
      for (const sz of ['0.0', 'abc']) {
        const result = read(LONG, [{ ...STOP, sz }]);
        expect(result.sl).toEqual({ state: 'none' });
        expect(result.notes[0]?.text).toBe(`SL size "${sz}" not counted`);
      }
    });
  });

  describe('unknown, never a guess', () => {
    it('when the open orders could not be read', () => {
      expect(positionProtection(LONG, null)).toEqual({
        verdict: 'unknown',
        reason: 'Open orders unreadable',
      });
    });

    it('when the position size does not read', () => {
      expect(positionProtection({ coin: 'ETH', szi: '0.0' }, [STOP]).verdict).toBe('unknown');
    });
  });
});

describe('botManagedPairs', () => {
  const settings = (hl: Partial<IExchange> | undefined): Record<string, IExchange> =>
    hl ? { hyperliquid: { pairs: [], ...hl } } : {};
  const pair = (name: string, enabled?: boolean) =>
    ({ name, ratio: 1, interval: '60', enabled }) as IExchange['pairs'][number];

  // La règle du moteur du bot : l'exchange et la paire à `true`, strictement.
  it('holds the enabled pairs of an enabled Hyperliquid exchange', () => {
    const managed = botManagedPairs(
      settings({ enabled: true, pairs: [pair('ETH', true), pair('BTC', false), pair('SOL')] }),
    );
    expect([...managed]).toEqual(['ETH']);
  });

  it('holds nothing when the exchange is disabled or absent', () => {
    expect(botManagedPairs(settings({ enabled: false, pairs: [pair('ETH', true)] })).size).toBe(0);
    expect(botManagedPairs(settings({ pairs: [pair('ETH', true)] })).size).toBe(0);
    expect(botManagedPairs(undefined).size).toBe(0);
  });
});
