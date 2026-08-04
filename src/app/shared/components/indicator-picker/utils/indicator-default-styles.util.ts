import { SubFieldStyle } from '../models/indicator.model';

/** Couleurs/styles par défaut par indicateur+sous-champ, alignés sur les conventions TradingView.
 *  ⚠️ Les clés de sous-champ (upper/middle/lower...) doivent matcher EXACTEMENT `subField.name` du backend. */
export const INDICATOR_DEFAULT_STYLES: Record<string, Record<string, SubFieldStyle>> = {
  bb: {
    upper: { color: '#2196f3', lineStyle: 'dashed' },
    middle: { color: '#2196f3', lineStyle: 'solid' },
    lower: { color: '#2196f3', lineStyle: 'dashed' },
  },
  ichimoku: {
    conversion: { color: '#3179F5', lineStyle: 'solid' },
    base: { color: '#801922', lineStyle: 'solid' },
    spanA: { color: '#A5D6A7', lineStyle: 'solid' },
    spanB: { color: '#FAA1A4', lineStyle: 'solid' },
    chikou: { color: '#43A047', lineStyle: 'solid' },
  },
  macd: {
    macd: { color: '#2196f3', lineStyle: 'solid' },
    signal: { color: '#ff6d00', lineStyle: 'solid' },
    histogram: { color: '#22ab94', lineStyle: 'solid' },
  },
  adx: {
    adx: { color: '#7e57c2', lineStyle: 'solid' },
    pdi: { color: '#26a69a', lineStyle: 'solid' },
    mdi: { color: '#ef5350', lineStyle: 'solid' },
  },
  supertrend: {
    supertrend: { color: '#26a69a', lineStyle: 'solid' },
    direction: { color: '#ef5350', lineStyle: 'solid' },
  },
  keltner: {
    upper: { color: '#ff6d00', lineStyle: 'dashed' },
    middle: { color: '#ff6d00', lineStyle: 'solid' },
    lower: { color: '#ff6d00', lineStyle: 'dashed' },
  },
  stochrsi: {
    k: { color: '#2196f3', lineStyle: 'solid' },
    d: { color: '#ff6d00', lineStyle: 'solid' },
    stochRSI: { color: '#7e57c2', lineStyle: 'dotted' },
  },
  pivotpoints: {
    pivot: { color: '#9e9e9e', lineStyle: 'solid' },
    r1: { color: '#ef5350', lineStyle: 'dashed' },
    r2: { color: '#ef5350', lineStyle: 'dashed' },
    r3: { color: '#ef5350', lineStyle: 'dashed' },
    r4: { color: '#ef5350', lineStyle: 'dashed' },
    s1: { color: '#26a69a', lineStyle: 'dashed' },
    s2: { color: '#26a69a', lineStyle: 'dashed' },
    s3: { color: '#26a69a', lineStyle: 'dashed' },
    s4: { color: '#26a69a', lineStyle: 'dashed' },
  },
};

export const SIMPLE_INDICATOR_DEFAULT_COLORS: Record<string, string> = {
  rsi: '#7e57c2',
  atr: '#801922',
  sd: '#089981',
};

export function defaultStyleFor(
  indicatorName: string,
  field: string,
  fallbackColor: string,
): SubFieldStyle {
  return (
    INDICATOR_DEFAULT_STYLES[indicatorName]?.[field] ?? { color: fallbackColor, lineStyle: 'solid' }
  );
}
