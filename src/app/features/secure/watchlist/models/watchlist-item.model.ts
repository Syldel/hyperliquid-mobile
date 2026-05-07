import { CandleInterval } from '@syldel/hl-shared-types';

export interface WatchlistItem {
  coin: string;
  interval: CandleInterval;
  addedAt: number;
}

export const CANDLE_INTERVALS: CandleInterval[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
];

export const INTERVAL_LABELS: Record<CandleInterval, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '8h': '8H',
  '12h': '12H',
  '1d': '1D',
  '3d': '3D',
  '1w': '1W',
  '1M': '1M',
};

export interface DatePreset {
  label: string;
  days: number;
  interval: CandleInterval;
}

export const DATE_PRESETS: DatePreset[] = [
  { label: '1D', days: 1, interval: '5m' },
  { label: '1W', days: 7, interval: '1h' },
  { label: '1M', days: 30, interval: '4h' },
  { label: '3M', days: 90, interval: '1d' },
  { label: '6M', days: 180, interval: '1d' },
  { label: '1Y', days: 365, interval: '1d' },
];
