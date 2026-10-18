import { HLOrderDetails } from '@syldel/hl-shared-types';
import { roundPrice, roundSize } from './hl-rounding.utils';
import { limitSpread, marketTriggerBound } from './limit-spread.util';

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

  // Le prix limite de l'ordre de clôture. Au marché, l'exchange recalcule sa propre borne de 10 %
  // et ignore `p` (mesuré le 2026-10-18, voir `limit-spread.util.ts`) : on envoie cette borne. Un
  // déclencheur LIMITE a un vrai plancher, écarté de 5 % (SL) ou 1,5 % (TP). Avant le
  // 2026-10-18 l'écart valait 0,1 % quoi qu'on choisisse : sans effet au marché, mais un plancher
  // trop serré pour une exécution limite.
  const spread = limitSpread(protective.kind);
  const limitPx = protective.isMarket
    ? marketTriggerBound({
        triggerPx,
        isBuy: closingIsBuy,
        szDecimals: main.szDecimals,
        isSpot: main.isSpot,
      })
    : roundPrice(
        triggerPxNum * (closingIsBuy ? 1 + spread : 1 - spread),
        main.szDecimals,
        main.isSpot,
      );

  const szNum = (mainSz * protective.sizePercent) / 100;

  return {
    assetName: main.assetName,
    isBuy: closingIsBuy,
    limitPx,
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
