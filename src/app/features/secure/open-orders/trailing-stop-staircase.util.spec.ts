import { BRENT_5M, BRENT_T0, S6_BTC_1M, S6_T0 } from './trailing-stop-staircase.fixtures';
import {
  roundToTick,
  stopAt,
  type StaircaseCandle,
  type StaircaseStep,
  trailingStaircase,
  trailingStaircaseOf,
} from './trailing-stop-staircase.util';

const MIN = 60_000;
const candles = (rows: readonly (readonly [number, number, number])[], t0: number, step: number) =>
  rows.map(([i, h, l]): StaircaseCandle => ({ t: t0 + i * step, h, l }));

const drawn = (r: ReturnType<typeof trailingStaircase>) => {
  if (r.kind !== 'drawn') throw new Error(`expected a staircase, got: ${r.reason}`);
  return r;
};
const stepAt = (steps: StaircaseStep[], time: number, interval: number) =>
  steps.find((s) => s.t <= time && time < s.t + interval);

/**
 * S6 : trailing d'achat BTC à 0,3 %, posé le 2026-11-17 à 14:07:07Z, déclenché à 14:33:39.946Z avec un
 * stop appliqué de 64 983,4 (`nest-trading-bot/docs/hyperliquid/live-check.md`). Le watermark de la
 * pose et celui de la fin s'en déduisent : stop ÷ 1,003.
 */
const S6 = {
  side: 'B' as const,
  retracement: { kind: 'pct' as const, pct: '0.3' },
  start: { time: Date.UTC(2026, 10, 17, 14, 7, 7), best: 64971 },
  end: { time: Date.UTC(2026, 10, 17, 14, 33, 39, 946), best: 64983.4 / 1.003 },
  candles: candles(S6_BTC_1M, S6_T0, MIN),
  intervalMs: MIN,
  // BTC : szDecimals 5.
  pxDecimals: 1,
};

/** Les stops lus en cours de route sur `frontendOpenOrders`, le même jour. */
const S6_MEASURED: [time: number, stop: number][] = [
  [Date.UTC(2026, 10, 17, 14, 7, 43), 65143.8],
  [Date.UTC(2026, 10, 17, 14, 13, 46), 65113.8],
  [Date.UTC(2026, 10, 17, 14, 26, 38), 65087.7],
];

/**
 * BRENTOIL : trailing de vente à 5 % posé par le Replace du SL, le 2026-11-19 à 23:09:14.849Z, au
 * watermark 90,075 ; listé le 2026-11-20 vers 22:31Z au watermark 90,398, stop 85.8781.
 */
const BRENT = {
  side: 'A' as const,
  retracement: { kind: 'pct' as const, pct: '5' },
  start: { time: Date.UTC(2026, 10, 19, 23, 9, 14, 849), best: 90.075 },
  end: { time: Date.UTC(2026, 10, 20, 22, 31), best: 90.398 },
  candles: candles(BRENT_5M, BRENT_T0, 5 * MIN),
  intervalMs: 5 * MIN,
  // xyz:BRENTOIL : szDecimals 2.
  pxDecimals: 4,
};

describe('trailingStaircase', () => {
  describe('against the measured S6 trailing (BTC buy, 0.3 %)', () => {
    it('ends exactly on the stop the exchange applied', () => {
      const { steps } = drawn(trailingStaircase(S6));
      expect(steps.at(-1)!.to).toBe(64983.4);
    });

    it('holds every stop read on the way inside its candle band, to 0.01 %', () => {
      const { steps } = drawn(trailingStaircase(S6));
      for (const [time, stop] of S6_MEASURED) {
        const step = stepAt(steps, time, MIN)!;
        const tolerance = stop * 0.0001;
        // Un trailing d'achat descend : la bande va de `from` (haut) à `to` (bas).
        expect(stop).toBeLessThanOrEqual(step.from + tolerance);
        expect(stop).toBeGreaterThanOrEqual(step.to - tolerance);
      }
    });

    it('cuts the trade wicks that went past the mark watermark, and says by how much', () => {
      const r = drawn(trailingStaircase(S6));
      // Une mèche d'échange à 64 767 contre un watermark mark de 64 788,9 : 21,9 $ (0,034 %).
      expect(r.clipped).toBeCloseTo(64983.4 / 1.003 - 64767, 6);
      expect(r.missed).toBe(0);
      for (const s of r.steps) expect(s.to).toBeGreaterThanOrEqual(64983.4 - 1e-9);
    });

    it('never moves the stop back: each band starts where the last one could have ended', () => {
      const { steps } = drawn(trailingStaircase(S6));
      for (const [i, s] of steps.entries()) {
        expect(s.to).toBeLessThanOrEqual(s.from);
        if (i > 0) expect(s.to).toBeLessThanOrEqual(steps[i - 1].to);
      }
    });

    it('starts at the placement candle and stops at the trigger candle', () => {
      const { steps } = drawn(trailingStaircase(S6));
      expect(steps[0].t).toBe(Date.UTC(2026, 10, 17, 14, 7));
      // Le stop de la pose tel que l'exchange l'a écrit, sur sa grille.
      expect(steps[0].from).toBe(65165.9);
      expect(steps.at(-1)!.t).toBe(Date.UTC(2026, 10, 17, 14, 33));
    });
  });

  describe('against the measured BRENTOIL trailing (sell, 5 %)', () => {
    it('ends exactly on the listed stop', () => {
      const r = drawn(trailingStaircase(BRENT));
      expect(r.steps.at(-1)!.to).toBe(85.8781);
      // 90,400 en échange contre 90,398 en mark.
      expect(r.clipped).toBeCloseTo(0.002, 9);
      expect(r.missed).toBe(0);
    });

    it('does not take the placement candle high for granted: part of it came before the placement', () => {
      const { steps } = drawn(trailingStaircase(BRENT));
      // La bougie de 23:05Z est montée à 90,126 ; la pose s'est faite à 90,075, à 23:09:14.
      expect(steps[0].to).toBe(85.6197);
      // La bougie suivante repart du watermark sûr, pas de cette mèche : 90,075 × 0,95.
      expect(steps[1].from).toBe(85.5713);
    });

    it('has no staircase for a trailing placed before the first candle', () => {
      // 610708645016, posé à 22:15:59.812Z : avant la première bougie de la série.
      const r = trailingStaircase({
        ...BRENT,
        start: { time: Date.UTC(2026, 10, 19, 22, 15, 59, 812), best: 90.129 },
      });
      expect(r.kind).toBe('uncovered');
    });
  });

  it('says how far the last step had to jump when no candle reached the present watermark', () => {
    const r = drawn(
      trailingStaircase({
        side: 'A',
        retracement: { kind: 'px', px: '10' },
        start: { time: 0, best: 100 },
        end: { time: 2 * MIN + 1, best: 105 },
        candles: [
          { t: 0, h: 101, l: 99 },
          { t: MIN, h: 103, l: 100 },
          { t: 2 * MIN, h: 104, l: 102 },
        ],
        intervalMs: MIN,
        pxDecimals: 2,
      }),
    );
    expect(r.missed).toBe(1);
    expect(r.steps.at(-1)).toEqual({ t: 2 * MIN, from: 93, to: 95 });
  });

  it('has no staircase when no candle holds the present state', () => {
    const r = trailingStaircase({ ...S6, end: { ...S6.end, time: S6_T0 + 60 * MIN } });
    expect(r.kind).toBe('uncovered');
  });

  it('refuses a present state that goes back on the placement', () => {
    const r = trailingStaircase({ ...BRENT, end: { ...BRENT.end, best: 90 } });
    expect(r.kind).toBe('uncovered');
  });
});

describe('stopAt', () => {
  it('puts a sell stop under the watermark and a buy stop over it, in percent or in price', () => {
    expect(stopAt('A', { kind: 'pct', pct: '5' }, 90.398)).toBeCloseTo(85.8781, 9);
    expect(stopAt('B', { kind: 'pct', pct: '0.3' }, 64971)).toBeCloseTo(65165.913, 6);
    expect(stopAt('A', { kind: 'px', px: '275' }, 2000)).toBe(1725);
    expect(stopAt('B', { kind: 'px', px: '275' }, 2000)).toBe(2275);
  });
});

describe('roundToTick', () => {
  it('rounds a tie up, as the exchange wrote 85.5713 for 90.075 × 0.95 = 85.57125', () => {
    // Le produit flottant vaut 85,571249999… : un `toFixed(4)` naïf rendait 85.5712.
    expect(roundToTick(90.075 * 0.95, 4)).toBe(85.5713);
  });

  it('rounds to the nearest tick, not down: 64 919 × 1.003 = 65 113.757 was written 65113.8', () => {
    expect(roundToTick(64919 * 1.003, 1)).toBe(65113.8);
    expect(roundToTick(64949 * 1.003, 1)).toBe(65143.8);
  });
});

describe('trailingStaircaseOf', () => {
  // 610736354584 tel que `historicalOrders` en garde la pose et que `frontendOpenOrders` le listait le
  // 2026-11-20 au soir.
  const OID = 610736354584;
  const LISTED = {
    oid: OID,
    side: 'A' as const,
    orderType: 'Trailing Stop Market',
    triggerCondition: 'Activation immediate, retracement 5%, best 90.398',
    triggerPx: '85.8781',
  };
  const POSE = {
    order: {
      ...LISTED,
      triggerCondition: 'Activation immediate, retracement 5%, best 90.075',
      triggerPx: '85.5713',
    },
    status: 'open',
    statusTimestamp: BRENT.start.time,
  };
  const at = (h: number, m: number) => Date.UTC(2026, 10, 20, h, m);

  it('draws from the placement to the listed stop, with the candles the chart already has', () => {
    const r = drawn(trailingStaircaseOf(LISTED, [POSE], BRENT.candles, 5 * MIN, at(22, 31)));
    // Sans arrondi sur la grille (le chart n'a pas la méta) : 90,075 × 0,95, que l'exchange écrit 85.5713.
    expect(r.steps[0].from).toBeCloseTo(85.57125, 9);
    expect(r.steps.at(-1)!.to).toBeCloseTo(85.8781, 9);
  });

  // Le cache des bougies dure un quart de leur intervalle : la dernière peut avoir fini avant `now`.
  it('puts the present state on the last candle when it is at most one interval behind', () => {
    const r = drawn(trailingStaircaseOf(LISTED, [POSE], BRENT.candles, 5 * MIN, at(22, 39)));
    expect(r.steps.at(-1)!.t).toBe(at(22, 30));
    expect(r.steps.at(-1)!.to).toBeCloseTo(85.8781, 9);
  });

  it('draws nothing when the candles stop more than one interval before the present', () => {
    const r = trailingStaircaseOf(LISTED, [POSE], BRENT.candles, 5 * MIN, at(22, 40));
    expect(r.kind).toBe('uncovered');
  });

  it('draws nothing without the placement, or for one placed waiting', () => {
    expect(trailingStaircaseOf(LISTED, [], BRENT.candles, 5 * MIN, at(22, 31)).kind).toBe(
      'uncovered',
    );
    const waiting = {
      ...POSE,
      order: {
        ...POSE.order,
        triggerCondition: 'Activation above 90.2, retracement 5%, best waiting',
        triggerPx: '0.0',
      },
    };
    expect(trailingStaircaseOf(LISTED, [waiting], BRENT.candles, 5 * MIN, at(22, 31)).kind).toBe(
      'uncovered',
    );
  });
});
