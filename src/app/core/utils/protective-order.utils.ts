import { HLOrderDetails } from '@syldel/hl-shared-types';
import { roundPrice, roundSize } from './hl-rounding.utils';

export type ProtectiveOrderKind = 'tp' | 'sl';

export interface MainOrderContext {
  assetName: string;
  isBuy: boolean;
  limitPx: string;
  sz: string;
  szDecimals: number;
  isSpot: boolean;
}

export interface ProtectiveOrderParams {
  kind: ProtectiveOrderKind;
  sizePercent: number;
  priceOffsetPercent: number;
  isMarket: boolean;
}

const TRIGGER_EXEC_OFFSET = 0.001; // 0.1% de marge d'exécution sur l'ordre de clôture

/**
 * Calcule le trigger price absolu à partir du % d'offset et du contexte live de l'ordre principal.
 * TP: au-dessus du limit si long, en-dessous si short. SL: l'inverse.
 */
export function computeProtectiveTriggerPx(
  main: Pick<MainOrderContext, 'isBuy' | 'limitPx' | 'szDecimals' | 'isSpot'>,
  protective: Pick<ProtectiveOrderParams, 'kind' | 'priceOffsetPercent'>,
): string {
  const limit = parseFloat(main.limitPx);
  if (!limit) return '';

  const isAbove = protective.kind === 'tp' ? main.isBuy : !main.isBuy;
  const factor = isAbove
    ? 1 + protective.priceOffsetPercent / 100
    : 1 - protective.priceOffsetPercent / 100;

  return roundPrice(limit * factor, main.szDecimals, main.isSpot);
}

/** Construit le HLOrderDetails concret à partir du contexte live + des paramètres relatifs stockés. */
export function buildProtectiveOrderDetails(
  main: MainOrderContext,
  protective: ProtectiveOrderParams,
): HLOrderDetails {
  const mainSz = parseFloat(main.sz) || 0;
  const closingIsBuy = !main.isBuy;

  const triggerPx = computeProtectiveTriggerPx(main, protective);
  const triggerPxNum = parseFloat(triggerPx);

  const execFactor = closingIsBuy ? 1 + TRIGGER_EXEC_OFFSET : 1 - TRIGGER_EXEC_OFFSET;
  const limitPxNum = triggerPxNum * execFactor;

  const szNum = (mainSz * protective.sizePercent) / 100;

  return {
    assetName: main.assetName,
    isBuy: closingIsBuy,
    limitPx: roundPrice(limitPxNum, main.szDecimals, main.isSpot),
    sz: roundSize(szNum, main.szDecimals),
    reduceOnly: true,
    orderType: {
      trigger: {
        isMarket: protective.isMarket,
        triggerPx,
        tpsl: protective.kind,
      },
    },
  };
}
