import { toExpressionSeries } from './expression-series.util';

describe('toExpressionSeries', () => {
  it('converts milliseconds to the seconds the chart expects', () => {
    const { points } = toExpressionSeries([{ time: 1_700_000_000_000, value: 42 }]);

    expect(points).toEqual([{ time: 1_700_000_000, value: 42 }]);
  });

  // Le cœur du sujet : un `null` au milieu d'une série amorcée doit se voir.
  it('turns an indeterminate value into a gap rather than dropping the point', () => {
    const { points } = toExpressionSeries([
      { time: 1000, value: 1 },
      { time: 2000, value: null },
      { time: 3000, value: 3 },
    ]);

    expect(points).toEqual([{ time: 1, value: 1 }, { time: 2 }, { time: 3, value: 3 }]);
  });

  it('counts the holes that open after the series started', () => {
    const series = toExpressionSeries([
      { time: 1000, value: 1 },
      { time: 2000, value: null },
      { time: 3000, value: 3 },
      { time: 4000 },
    ]);

    expect(series.indeterminate).toBe(2);
  });

  // Un `zscore` sur 200 bougies n'a rien à dire des 199 premières : c'est le
  // fonctionnement d'une fenêtre glissante, pas une anomalie à signaler.
  it('does not count the warm-up that every rolling window has', () => {
    const series = toExpressionSeries([
      { time: 1000, value: null },
      { time: 2000, value: null },
      { time: 3000, value: 3 },
    ]);

    expect(series.indeterminate).toBe(0);
    expect(series.points).toEqual([{ time: 1 }, { time: 2 }, { time: 3, value: 3 }]);
  });

  it('reports nothing for a series that never produced a value', () => {
    expect(toExpressionSeries([{ time: 1000, value: null }, { time: 2000 }]).indeterminate).toBe(0);
  });

  it('treats a non-finite number as indeterminate too', () => {
    const series = toExpressionSeries([
      { time: 1000, value: 1 },
      { time: 2000, value: Number.NaN },
      { time: 3000, value: Number.POSITIVE_INFINITY },
    ]);

    expect(series.indeterminate).toBe(2);
    expect(series.points).toEqual([{ time: 1, value: 1 }, { time: 2 }, { time: 3 }]);
  });

  it('keeps a zero, which is a value like any other', () => {
    const series = toExpressionSeries([{ time: 1000, value: 0 }]);

    expect(series.points).toEqual([{ time: 1, value: 0 }]);
    expect(series.indeterminate).toBe(0);
  });

  it('handles a series the response did not carry', () => {
    expect(toExpressionSeries(undefined)).toEqual({ points: [], indeterminate: 0 });
    expect(toExpressionSeries([])).toEqual({ points: [], indeterminate: 0 });
  });
});
