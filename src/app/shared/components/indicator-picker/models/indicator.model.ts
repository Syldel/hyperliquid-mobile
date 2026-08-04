import { IndicatorRequest } from '@syldel/trading-shared-types';

export interface SubFieldStyle {
  color: string;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  visible: boolean;
}

export interface ActiveIndicator {
  id: string;
  request: IndicatorRequest;
  visible: boolean;
  color: string;
  subFieldStyles?: Record<string, SubFieldStyle>;
}
