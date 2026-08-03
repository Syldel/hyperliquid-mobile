import {
  buildIndicatorKeyFromOperand,
  IndicatorRequest,
} from '@syldel/trading-shared-types';

/** Clé stable par type+params (ex: "ema_9", "hma_9", "macd_12_26_9").
 *  Sert à indexer la réponse /analysis ET à partager une couleur entre tous les charts.
 *  Délègue au registre partagé (`INDICATOR_DEFAULTS`) pour toute valeur omise,
 *  afin de rester identique à la clé calculée côté bot. */
export function buildIndicatorKey(req: IndicatorRequest): string {
  return buildIndicatorKeyFromOperand(req);
}
