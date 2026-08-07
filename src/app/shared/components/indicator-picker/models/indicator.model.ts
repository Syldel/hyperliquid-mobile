import { IndicatorRequest } from '@syldel/trading-shared-types';

export type LineStyleType = 'solid' | 'dashed' | 'dotted';

export interface SubFieldStyle {
  color: string;
  lineStyle: LineStyleType;
  visible: boolean;
}

/** Ligne de niveau horizontale (à la TradingView : "Upper Band", "Middle Band"...).
 *  Purement visuelle — ne participe jamais au calcul de l'indicateur.
 *  `id` est stable dans le temps (généré une fois, persisté) pour permettre
 *  l'ajout/suppression individuelle depuis l'UI sans perturber les autres lignes. */
export interface HlineStyle {
  id: string;
  visible: boolean;
  value: number;
  color: string;
  lineStyle: LineStyleType;
}

/** Zone colorée entre deux niveaux (ex: bande 70/30 pour un RSI).
 *  `opacity` est toujours renseignée (0-100) : une zone sans opacité n'a pas de sens visuel. */
export interface HlineZoneStyle {
  id: string;
  visible: boolean;
  upperValue: number;
  lowerValue: number;
  color: string;
  opacity: number;
}

export interface IndicatorHlineStyles {
  lines: HlineStyle[];
  zones: HlineZoneStyle[];
}

export interface ActiveIndicator {
  id: string;
  request: IndicatorRequest;
  visible: boolean;
  color: string;
  subFieldStyles?: Record<string, SubFieldStyle>;
  /** Uniquement renseigné pour les indicateurs listés dans HlineIndicatorName
   *  (RSI, Stoch RSI, CHOP) — cf. utils/indicator-hline-defaults.util.ts */
  hlines?: IndicatorHlineStyles;
}
