import type { ActiveIndicator } from '@shared/components/indicator-picker/models/indicator.model';
import type { IndicatorRequest } from '@syldel/trading-shared-types';
import { mapIndicatorSeriesById } from './indicator-series-map.util';

function activeIndicator(id: string, request: IndicatorRequest): ActiveIndicator {
  return { id, request, visible: true, color: '#fff' };
}

/** Reproduit le format serveur (`name_p1_p2`) sans dépendre du catalogue. */
function keyOf(request: IndicatorRequest): string | null {
  const { name, ...params } = request as { name: string } & Record<string, unknown>;
  if (name === 'unknown') return null;
  const values = Object.values(params);
  return values.length > 0 ? `${name}_${values.join('_')}` : name;
}

describe('mapIndicatorSeriesById', () => {
  it('maps each active indicator to the series under its own key', () => {
    const response = { ema_9: ['a'], sma_20: ['b'] };
    const active = [
      activeIndicator('i1', { name: 'ema', period: 9 }),
      activeIndicator('i2', { name: 'sma', period: 20 }),
    ];

    const result = mapIndicatorSeriesById(response, active, keyOf);

    expect(result.get('i1')).toEqual(['a']);
    expect(result.get('i2')).toEqual(['b']);
  });

  // Le bug d'origine : par index, inverser l'ordre inversait les séries.
  it('is unaffected by the order of the active indicators', () => {
    const response = { ema_9: ['ema'], sma_20: ['sma'] };
    const reordered = [
      activeIndicator('i2', { name: 'sma', period: 20 }),
      activeIndicator('i1', { name: 'ema', period: 9 }),
    ];

    const result = mapIndicatorSeriesById(response, reordered, keyOf);

    expect(result.get('i1')).toEqual(['ema']);
    expect(result.get('i2')).toEqual(['sma']);
  });

  // L'autre moitié du bug : le serveur ne renvoie qu'une entrée pour deux
  // indicateurs identiques, l'appariement par index décalait alors tout.
  it('gives both duplicates the same series instead of shifting the rest', () => {
    const response = { ema_9: ['ema'], rsi_14: ['rsi'] };
    const active = [
      activeIndicator('i1', { name: 'ema', period: 9 }),
      activeIndicator('i2', { name: 'ema', period: 9 }),
      activeIndicator('i3', { name: 'rsi', period: 14 }),
    ];

    const result = mapIndicatorSeriesById(response, active, keyOf);

    expect(result.get('i1')).toEqual(['ema']);
    expect(result.get('i2')).toEqual(['ema']);
    expect(result.get('i3')).toEqual(['rsi']);
  });

  it('skips an indicator whose key cannot be built', () => {
    const response = { ema_9: ['ema'] };
    const active = [
      activeIndicator('i1', { name: 'unknown' } as unknown as IndicatorRequest),
      activeIndicator('i2', { name: 'ema', period: 9 }),
    ];

    const result = mapIndicatorSeriesById(response, active, keyOf);

    expect(result.has('i1')).toBe(false);
    expect(result.get('i2')).toEqual(['ema']);
  });

  it('skips an indicator the response has no series for', () => {
    const result = mapIndicatorSeriesById(
      { ema_9: ['ema'] },
      [activeIndicator('i1', { name: 'sma', period: 20 })],
      keyOf,
    );

    expect(result.size).toBe(0);
  });

  it('handles a parameterless indicator', () => {
    const result = mapIndicatorSeriesById(
      { obv: ['obv'] },
      [activeIndicator('i1', { name: 'obv' })],
      keyOf,
    );

    expect(result.get('i1')).toEqual(['obv']);
  });
});
