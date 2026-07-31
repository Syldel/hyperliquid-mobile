import { IndicatorRequest } from '@syldel/trading-shared-types';

/** Clé stable par type+params (ex: "ema_9", "hma_55", "macd_12_26_9").
 *  Sert à indexer la réponse /analysis ET à partager une couleur entre tous les charts. */
export function buildIndicatorKey(req: IndicatorRequest): string {
  switch (req.name) {
    case 'macd':
      return `macd_${req.fastPeriod ?? 12}_${req.slowPeriod ?? 26}_${req.signalPeriod ?? 9}`;
    case 'ichimoku':
      return `ichimoku_${req.conversionPeriod ?? 9}_${req.basePeriod ?? 26}_${req.spanPeriod ?? 52}_${req.displacement ?? 26}`;
    case 'bb':
      return `bb_${req.period ?? 20}_${req.stdDev ?? 2}`;
    default:
      return `${req.name}_${req.period ?? (req.name === 'rsi' || req.name === 'atr' || req.name === 'sd' ? 14 : 20)}`;
  }
}
