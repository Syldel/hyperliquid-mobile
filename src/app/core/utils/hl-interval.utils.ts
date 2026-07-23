import { CandleInterval } from '@syldel/hl-shared-types';
import { ChartInterval } from '@syldel/trading-shared-types';

/**
 * Maps Hyperliquid's CandleInterval to the universal ChartInterval used by /analysis.
 * Falls back to '60' ('1h' equivalent) if the interval has no ChartInterval mapping.
 */
export function toChartInterval(interval: CandleInterval): ChartInterval {
  const mapping: Record<CandleInterval, ChartInterval | null> = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '1d': '1D',
    '1w': '1W',
    '1M': '1M',
    // No ChartInterval equivalent for these — adjust once CandleInterval's real
    // member list is confirmed (see open question in trading-shared-types README)
    '8h': null,
    '12h': null,
    '3d': null,
  };

  const result = mapping[interval];
  if (!result) {
    console.warn(
      `[Analysis] Interval "${interval}" has no ChartInterval equivalent. Falling back to "60".`,
    );
    return '60';
  }
  return result;
}
