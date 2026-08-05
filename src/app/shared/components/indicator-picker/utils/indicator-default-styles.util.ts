import { INDICATOR_SUBFIELDS, MultiLineIndicatorName } from '@syldel/trading-shared-types';
import { SubFieldStyle } from '../models/indicator.model';

/** Noms de subField valides pour un indicateur, dérivés du registre partagé —
 *  source unique de vérité, jamais recopiée ici. */
type SubFieldNameOf<N extends MultiLineIndicatorName> =
  (typeof INDICATOR_SUBFIELDS)[N][number]['name'];

/**
 * Couleurs/styles par défaut par indicateur+sous-champ.
 *
 * Le type est dérivé de `INDICATOR_SUBFIELDS` : toute ligne ajoutée, renommée
 * ou retirée côté shared-types casse la compilation ici tant que ce fichier
 * n'est pas mis à jour. Impossible d'oublier un indicateur multi-lignes ou de
 * mal orthographier une clé de subField — l'erreur remontée pour Keltner plus
 * tôt dans le projet aurait été détectée à la compilation avec ce typage.
 */
export const INDICATOR_DEFAULT_STYLES: {
  [N in MultiLineIndicatorName]: Record<SubFieldNameOf<N>, SubFieldStyle>;
} = {
  bb: {
    upper: { color: '#2196f3', lineStyle: 'dashed', visible: true },
    middle: { color: '#2196f3', lineStyle: 'solid', visible: true },
    lower: { color: '#2196f3', lineStyle: 'dashed', visible: true },
  },
  ichimoku: {
    conversion: { color: '#3179F5', lineStyle: 'solid', visible: true },
    base: { color: '#801922', lineStyle: 'solid', visible: true },
    spanA: { color: '#A5D6A7', lineStyle: 'solid', visible: true },
    spanB: { color: '#FAA1A4', lineStyle: 'solid', visible: true },
    chikou: { color: '#43A047', lineStyle: 'solid', visible: true },
  },
  macd: {
    macd: { color: '#2196f3', lineStyle: 'solid', visible: true },
    signal: { color: '#ff6d00', lineStyle: 'solid', visible: true },
    histogram: { color: '#22ab94', lineStyle: 'solid', visible: true },
  },
  adx: {
    adx: { color: '#7e57c2', lineStyle: 'solid', visible: true },
    pdi: { color: '#26a69a', lineStyle: 'solid', visible: true },
    mdi: { color: '#ef5350', lineStyle: 'solid', visible: true },
  },
  keltner: {
    upper: { color: '#ff6d00', lineStyle: 'dashed', visible: true },
    middle: { color: '#ff6d00', lineStyle: 'solid', visible: true },
    lower: { color: '#ff6d00', lineStyle: 'dashed', visible: true },
  },
  supertrend: {
    supertrend: { color: '#26a69a', lineStyle: 'solid', visible: true },
    direction: { color: '#ef5350', lineStyle: 'solid', visible: false },
  },
  stochrsi: {
    k: { color: '#2196f3', lineStyle: 'solid', visible: true },
    d: { color: '#ff6d00', lineStyle: 'solid', visible: true },
    stochRSI: { color: '#7e57c2', lineStyle: 'dotted', visible: false },
  },
  pivotpoints: {
    pivot: { color: '#9e9e9e', lineStyle: 'solid', visible: true },
    r1: { color: '#ef5350', lineStyle: 'dashed', visible: true },
    r2: { color: '#ef5350', lineStyle: 'dashed', visible: true },
    r3: { color: '#ef5350', lineStyle: 'dashed', visible: true },
    r4: { color: '#ef5350', lineStyle: 'dashed', visible: true },
    s1: { color: '#26a69a', lineStyle: 'dashed', visible: true },
    s2: { color: '#26a69a', lineStyle: 'dashed', visible: true },
    s3: { color: '#26a69a', lineStyle: 'dashed', visible: true },
    s4: { color: '#26a69a', lineStyle: 'dashed', visible: true },
  },
};

export const SIMPLE_INDICATOR_DEFAULT_COLORS: Record<string, string> = {
  rsi: '#7e57c2',
  atr: '#801922',
  sd: '#089981',
};

/** `field` reste `string` : il vient de `IndicatorMetadata.subFields` (données
 *  backend, non typées côté front). La cohérence avec le registre partagé est
 *  vérifiée à l'exécution par `assertSubFieldsMatchRegistry` dans le picker. */
export function defaultStyleFor(
  indicatorName: string,
  field: string,
  fallbackColor: string,
): SubFieldStyle {
  const styles = (INDICATOR_DEFAULT_STYLES as Record<string, Record<string, SubFieldStyle>>)[
    indicatorName
  ];
  return styles?.[field] ?? { color: fallbackColor, lineStyle: 'solid', visible: true };
}
