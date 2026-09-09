import type { TimelineSignal } from '@syldel/trading-shared-types';
import { buildPositionBars, buildPositionSegments } from './position-segments.util';

function signal(time: number, kind: 'ENTER' | 'EXIT', side?: 'LONG' | 'SHORT'): TimelineSignal {
  return {
    time,
    signal: kind,
    metadata: { price: 1, cumulativeProfitPercent: 0, ...(side ? { side } : {}) },
  };
}

describe('buildPositionSegments', () => {
  it('pairs an entry with its exit', () => {
    const segments = buildPositionSegments([
      signal(100, 'ENTER', 'LONG'),
      signal(300, 'EXIT', 'LONG'),
    ]);

    expect(segments).toEqual([{ side: 'LONG', from: 100, to: 300 }]);
  });

  // C'est le `openPositionAtEnd` du bilan, rendu visible sur le chart.
  it('leaves a never-closed entry open', () => {
    expect(buildPositionSegments([signal(100, 'ENTER', 'LONG')])).toEqual([
      { side: 'LONG', from: 100, to: null },
    ]);
  });

  // Les branches long et short sont indépendantes : elles peuvent se chevaucher.
  it('tracks both sides independently, even when they overlap', () => {
    const segments = buildPositionSegments([
      signal(100, 'ENTER', 'LONG'),
      signal(150, 'ENTER', 'SHORT'),
      signal(200, 'EXIT', 'LONG'),
      signal(250, 'EXIT', 'SHORT'),
    ]);

    expect(segments).toEqual([
      { side: 'LONG', from: 100, to: 200 },
      { side: 'SHORT', from: 150, to: 250 },
    ]);
  });

  it('ignores an exit that closes nothing', () => {
    expect(buildPositionSegments([signal(100, 'EXIT', 'LONG')])).toEqual([]);
  });

  it('does not let a second entry restart an open position', () => {
    const segments = buildPositionSegments([
      signal(100, 'ENTER', 'LONG'),
      signal(150, 'ENTER', 'LONG'),
      signal(200, 'EXIT', 'LONG'),
    ]);

    expect(segments).toEqual([{ side: 'LONG', from: 100, to: 200 }]);
  });

  it('treats a missing side as long', () => {
    expect(buildPositionSegments([signal(100, 'ENTER'), signal(200, 'EXIT')])).toEqual([
      { side: 'LONG', from: 100, to: 200 },
    ]);
  });

  it('handles unordered input', () => {
    const segments = buildPositionSegments([
      signal(300, 'EXIT', 'LONG'),
      signal(100, 'ENTER', 'LONG'),
    ]);

    expect(segments).toEqual([{ side: 'LONG', from: 100, to: 300 }]);
  });

  it('returns nothing for no signals', () => {
    expect(buildPositionSegments([])).toEqual([]);
  });

  it('orders several closed positions by start time', () => {
    const segments = buildPositionSegments([
      signal(500, 'ENTER', 'SHORT'),
      signal(600, 'EXIT', 'SHORT'),
      signal(100, 'ENTER', 'LONG'),
      signal(200, 'EXIT', 'LONG'),
    ]);

    expect(segments.map((s) => s.from)).toEqual([100, 500]);
  });
});

describe('buildPositionBars', () => {
  const colors = { long: '#0f0', short: '#f00' };
  const candles = [1000, 2000, 3000, 4000, 5000];

  it('fills every candle covered by a segment, in seconds', () => {
    const bars = buildPositionBars([{ side: 'LONG', from: 2000, to: 4000 }], candles, 0, colors);

    expect(bars).toEqual([
      { time: 2, value: 0.8, color: '#0f0' },
      { time: 3, value: 0.8, color: '#0f0' },
    ]);
  });

  // La position est refermée à cet instant : la colorer la ferait courir trop loin.
  it('excludes the exit candle', () => {
    const bars = buildPositionBars([{ side: 'LONG', from: 1000, to: 3000 }], candles, 0, colors);
    expect(bars.map((b) => b.time)).toEqual([1, 2]);
  });

  it('runs an open segment to the last candle', () => {
    const bars = buildPositionBars([{ side: 'SHORT', from: 4000, to: null }], candles, 0, colors);
    expect(bars.map((b) => b.time)).toEqual([4, 5]);
  });

  it('colours by side', () => {
    const bars = buildPositionBars([{ side: 'SHORT', from: 1000, to: 3000 }], candles, 0, colors);
    expect(bars.every((b) => b.color === '#f00')).toBe(true);
  });

  it('places each strategy on its own row', () => {
    const segment = [{ side: 'LONG' as const, from: 1000, to: 3000 }];
    expect(buildPositionBars(segment, candles, 2, colors)[0].value).toBe(2.8);
  });

  it('leaves flat candles out entirely', () => {
    const bars = buildPositionBars([{ side: 'LONG', from: 3000, to: 4000 }], candles, 0, colors);
    expect(bars).toHaveLength(1);
  });

  it('handles unordered candle times', () => {
    const bars = buildPositionBars(
      [{ side: 'LONG', from: 1000, to: 4000 }],
      [3000, 1000, 2000],
      0,
      colors,
    );
    expect(bars.map((b) => b.time)).toEqual([1, 2, 3]);
  });
});
