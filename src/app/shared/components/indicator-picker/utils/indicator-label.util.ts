import { IndicatorRequest } from '@syldel/trading-shared-types';
import { buildIndicatorKey } from './indicator-key.util';

export function formatIndicatorLabel(req: IndicatorRequest): string {
  return buildIndicatorKey(req).replace(/_/g, ' ').toUpperCase();
}
