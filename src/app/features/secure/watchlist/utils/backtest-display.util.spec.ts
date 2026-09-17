import type { BacktestReport, BacktestStats } from '@syldel/trading-shared-types';
import {
  definedSides,
  equityLines,
  formatPercent,
  formatPrice,
  percentTone,
  tradeFocusRange,
} from './backtest-display.util';

/**
 * L'écran n'a pas le droit de recalculer le rapport du bot ; il choisit quoi
 * montrer. Chaque test fixe un de ces choix, là où un mauvais choix ferait lire
 * autre chose que ce que le bot a rapporté.
 */
const H = 3_600_000;

function stats(overrides: Partial<BacktestStats> = {}): BacktestStats {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    winRatePercent: null,
    realizedPercent: 0,
    unrealizedPercent: 0,
    maxDrawdown: { depthPercent: 0, peakTime: null, troughTime: null },
    ...overrides,
  };
}

function report(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    from: H,
    to: 2 * H,
    long: stats(),
    short: stats(),
    total: stats(),
    trades: [],
    openPositions: [],
    carriedIn: [],
    equity: [
      { time: H, long: 1, short: 2, total: 3 },
      { time: 2 * H, long: 4, short: 5, total: 9 },
    ],
    overlap: { candles: 0, firstTime: null },
    anomalies: [],
    ...overrides,
  };
}

describe('formatPercent', () => {
  it('always writes the sign of a non-zero value', () => {
    expect(formatPercent(1.234)).toBe('+1.23%');
    expect(formatPercent(-0.4)).toBe('-0.40%');
  });

  // Un −0,001 arrondi à « -0.00% » se lirait comme une perte.
  it('never shows a signed zero', () => {
    expect(formatPercent(-0.001)).toBe('0.00%');
    expect(formatPercent(0)).toBe('0.00%');
  });
});

describe('percentTone', () => {
  it('colours a gain up and a loss down', () => {
    expect(percentTone(1.2)).toBe('up');
    expect(percentTone(-0.4)).toBe('down');
  });

  // Vu sur un rapport réel : +0,005 % affiché « 0.00% » mais coloré en vert.
  it('judges the value as displayed, so a rounded zero stays neutral', () => {
    expect(percentTone(0.004)).toBeNull();
    expect(percentTone(-0.004)).toBeNull();
    expect(percentTone(0)).toBeNull();
  });
});

describe('formatPrice', () => {
  it('keeps a readable precision at any price scale', () => {
    expect(formatPrice(76438.5)).toBe('76,438.5');
    expect(formatPrice(0.0000123456)).toBe('0.0000123456');
  });
});

describe('definedSides', () => {
  it('lists only the sides a strategy has rules for', () => {
    expect(
      definedSides({ long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } }),
    ).toEqual(['LONG']);
    expect(definedSides(undefined)).toEqual([]);
  });
});

describe('equityLines', () => {
  it('draws the total alone when only one side traded', () => {
    const lines = equityLines(report({ long: stats({ trades: 2 }) }), ['LONG', 'SHORT']);

    expect(lines.map((l) => l.id)).toEqual(['total']);
    expect(lines[0]?.points.map((p) => p.value)).toEqual([3, 9]);
  });

  it('adds each side under the total when both sides traded', () => {
    const lines = equityLines(report({ long: stats({ trades: 1 }), short: stats({ trades: 1 }) }), [
      'LONG',
      'SHORT',
    ]);

    expect(lines.map((l) => l.id)).toEqual(['total', 'LONG', 'SHORT']);
  });

  // Le bot ne tient qu'une position par paire : une somme de deux côtés ouverts
  // ensemble ne doit apparaître nulle part, pas même en courbe.
  it('never draws a total when the report refuses one', () => {
    const lines = equityLines(
      report({
        total: null,
        long: stats({ trades: 1 }),
        short: stats({ trades: 1 }),
        equity: [{ time: H, long: 1, short: 2, total: null }],
      }),
      ['LONG', 'SHORT'],
    );

    expect(lines.map((l) => l.id)).toEqual(['LONG', 'SHORT']);
  });

  it('counts a side holding only an open position as active', () => {
    const lines = equityLines(
      report({
        long: stats({ trades: 1 }),
        openPositions: [
          {
            side: 'SHORT',
            entryTime: H,
            entryPrice: 1,
            markTime: 2 * H,
            markPrice: 1,
            unrealizedPercent: 0,
          },
        ],
      }),
      ['LONG', 'SHORT'],
    );

    expect(lines.map((l) => l.id)).toEqual(['total', 'LONG', 'SHORT']);
  });
});

describe('tradeFocusRange', () => {
  it('frames a short trade with at least ten candles on each side', () => {
    expect(tradeFocusRange({ entryTime: 100 * H, exitTime: 102 * H }, H, 500 * H)).toEqual({
      from: 90 * H,
      to: 112 * H,
    });
  });

  it('frames a long trade with half its duration on each side', () => {
    expect(tradeFocusRange({ entryTime: 100 * H, exitTime: 140 * H }, H, 500 * H)).toEqual({
      from: 80 * H,
      to: 160 * H,
    });
  });

  it('runs an open position to the last candle, never beyond', () => {
    expect(tradeFocusRange({ entryTime: 490 * H, exitTime: null }, H, 500 * H)).toEqual({
      from: 480 * H,
      to: 500 * H,
    });
  });
});
