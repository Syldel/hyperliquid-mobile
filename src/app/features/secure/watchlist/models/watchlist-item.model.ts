import { ActiveIndicator } from '@shared/components/indicator-picker/models/indicator.model';
import { CandleInterval } from '@syldel/hl-shared-types';

/**
 * Stratégie attachée à un chart, par **référence** à la bibliothèque
 * (`StrategyLibraryService`) et jamais par copie.
 *
 * Un tableau, comme `activeIndicators` : plusieurs stratégies peuvent être
 * attachées et visibles en même temps, et `visible` se pilote indépendamment
 * de l'attachement — masquer une stratégie ne la détache pas.
 *
 * Remplace l'ancien `activeStrategy?: AnalysisStrategyRequest | null`, qui
 * dupliquait les règles dans chaque élément de watchlist : deux copies de la
 * même stratégie pouvaient diverger sans que rien ne le signale. Voir
 * `migrateLegacyWatchlistStrategies` pour la reprise des données existantes.
 */
export interface StrategyRef {
  strategyId: string;
  visible: boolean;
}

export interface WatchlistItem {
  coin: string;
  interval: CandleInterval;
  addedAt: number;
  activeIndicators?: ActiveIndicator[];
  strategyRefs?: StrategyRef[];
}

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
