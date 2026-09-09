import type { TimelineSignal } from '@syldel/trading-shared-types';
import { buildStrategyMarkers, type StrategySignalLayer } from './strategy-markers.util';

function signal(time: number, kind: 'ENTER' | 'EXIT', side?: string): TimelineSignal {
  return {
    time,
    signal: kind,
    metadata: { price: 1, cumulativeProfitPercent: 0, ...(side ? { side } : {}) },
  };
}

function layer(
  strategyId: string,
  name: string,
  color: string,
  signals: TimelineSignal[],
): StrategySignalLayer {
  return { strategyId, name, color, signals };
}

describe('buildStrategyMarkers', () => {
  // Le côté est passé à la bande de positions : les marqueurs ne codent plus
  // que l'instant, avec position et forme qui se renforcent.
  it('encodes entry and exit by both position and shape, with the strategy colour', () => {
    const markers = buildStrategyMarkers([
      layer('s1', 'Breakout', '#4dd0e1', [
        signal(2000, 'ENTER', 'LONG'),
        signal(5000, 'EXIT', 'LONG'),
        signal(7000, 'ENTER', 'SHORT'),
      ]),
    ]);

    expect(markers).toEqual([
      { time: 2, position: 'belowBar', color: '#4dd0e1', shape: 'arrowUp' },
      { time: 5, position: 'aboveBar', color: '#4dd0e1', shape: 'arrowDown' },
      { time: 7, position: 'belowBar', color: '#4dd0e1', shape: 'arrowUp' },
    ]);
  });

  it('carries no text at all', () => {
    const markers = buildStrategyMarkers([
      layer('s1', 'Breakout', '#111', [signal(1000, 'ENTER', 'LONG')]),
      layer('s2', 'Reversal', '#222', [signal(2000, 'ENTER', 'SHORT')]),
    ]);

    expect(markers.every((marker) => !('text' in marker))).toBe(true);
  });

  // lightweight-charts exige des marqueurs triés : deux stratégies entrelacées
  // produisent mécaniquement des temps désordonnés une fois concaténées.
  it('sorts the merged markers by time across strategies', () => {
    const markers = buildStrategyMarkers([
      layer('s1', 'A', '#111', [signal(9000, 'ENTER'), signal(1000, 'ENTER')]),
      layer('s2', 'B', '#222', [signal(5000, 'ENTER'), signal(3000, 'ENTER')]),
    ]);

    expect(markers.map((m) => m.time)).toEqual([1, 3, 5, 9]);
  });

  it('keeps each strategy its own colour', () => {
    const markers = buildStrategyMarkers([
      layer('s1', 'A', '#111', [signal(1000, 'ENTER')]),
      layer('s2', 'B', '#222', [signal(2000, 'ENTER')]),
    ]);

    expect(markers.map((m) => m.color)).toEqual(['#111', '#222']);
  });

  it('does not look at the side at all — the positions band carries it', () => {
    const withSide = buildStrategyMarkers([
      layer('s1', 'A', '#111', [signal(1000, 'ENTER', 'SHORT')]),
    ]);
    const withoutSide = buildStrategyMarkers([layer('s1', 'A', '#111', [signal(1000, 'ENTER')])]);

    expect(withSide).toEqual(withoutSide);
  });

  it('returns nothing for no layers, or for layers without signals', () => {
    expect(buildStrategyMarkers([])).toEqual([]);
    expect(buildStrategyMarkers([layer('s1', 'A', '#111', [])])).toEqual([]);
  });
});
