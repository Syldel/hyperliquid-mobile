import { roundPrice } from '@utils/hl-rounding.utils';

import { limitSpread, type TriggerKind } from '@utils/limit-spread.util';

/** Ce qui, dans un ordre déclencheur, détermine le prix limite proposé. */
export interface TriggerOrderState {
  triggerPx: string;
  isMarket: boolean;
  tpsl: TriggerKind;
}

/** L'ordre EXISTANT à l'ouverture : son état, et le prix limite qu'il porte réellement. */
export interface OriginalTriggerOrder extends TriggerOrderState {
  limitPx: string;
}

export interface LimitFromTriggerInput extends TriggerOrderState {
  /**
   * L'ordre existant tel qu'à l'ouverture, ou `null` en création. En modification, un état
   * **identique** n'est pas une saisie de l'utilisateur : c'est l'ordre tel qu'il est, et
   * son limite est celui qu'il porte.
   */
  original: OriginalTriggerOrder | null;
  orderKind: 'limit' | 'trigger';
  isBuy: boolean;
  szDecimals: number;
  isSpot: boolean;
}

/**
 * Le prix limite à proposer pour un ordre déclencheur : le déclencheur écarté de
 * `limitSpread(tpsl, isMarket)`, arrondi comme l'exchange l'exige.
 *
 * - `null` : **rien à proposer** (ce n'est pas un ordre déclencheur).
 * - `''` : un déclencheur absent ou illisible — le limite proposé est vide, pas celui d'un
 *   déclencheur précédent.
 *
 * En modification, tant que l'ordre est tel qu'à l'ouverture, le limite proposé est **celui
 * de l'ordre** : sans ce garde, ouvrir un ordre existant remplaçait son vrai prix limite
 * (80000 devenait 81081, mesuré le 2026-10-16) ; et sans le retour à la valeur d'origine,
 * remettre le déclencheur à sa valeur laissait le limite dérivé de la saisie intermédiaire
 * (mesuré le même jour). Dès que le déclencheur, le type ou le TP/SL change, le limite suit
 * de nouveau — un premier garde coupait aussi ce suivi, qui existait avant.
 */
export function limitFromTrigger(input: LimitFromTriggerInput): string | null {
  if (input.orderKind !== 'trigger') return null;
  const o = input.original;
  if (
    o &&
    o.triggerPx === input.triggerPx &&
    o.isMarket === input.isMarket &&
    o.tpsl === input.tpsl
  ) {
    return o.limitPx;
  }

  const trigger = parseFloat(input.triggerPx);
  if (!trigger || trigger < 0) return '';

  const spread = limitSpread(input.tpsl, input.isMarket);
  const factor = input.isBuy ? 1 + spread : 1 - spread;
  return String(parseFloat(roundPrice(trigger * factor, input.szDecimals, input.isSpot)));
}

/** Un prix saisi est exploitable : un nombre strictement positif. */
export function isPositivePrice(text: string): boolean {
  const n = parseFloat(text);
  return Number.isFinite(n) && n > 0;
}

/**
 * Les prix dont l'ordre a besoin sont là. Sans ce contrôle, `roundPrice(parseFloat(''))`
 * rend la chaîne `"NaN"` — qui est truthy : le bouton restait actif et l'ordre partait avec
 * `limitPx: "NaN"` (mesuré le 2026-10-16), c'est le serveur qui le refusait. Un ordre
 * déclencheur a besoin des DEUX : le déclencheur, et le limite qui en est dérivé ou saisi.
 */
export function orderPricesReady(input: {
  orderKind: 'limit' | 'trigger';
  limitPx: string;
  triggerPx: string;
}): boolean {
  if (!isPositivePrice(input.limitPx)) return false;
  return input.orderKind !== 'trigger' || isPositivePrice(input.triggerPx);
}

/**
 * Le prix limite d'un ordre déclencheur est du MAUVAIS côté du déclencheur : sous lui pour un
 * achat, au-dessus pour une vente. Le limite est le pire prix accepté, donc il se trouve
 * toujours du côté où l'on accepte de payer plus (achat) ou de recevoir moins (vente) que le
 * déclencheur. Un limite inversé est un ordre qui se déclenche sans pouvoir s'exécuter, et rien
 * ne le dit : c'est ce que permet un limite saisi à la main, qui survit à un changement de sens
 * (mesuré le 2026-10-16). Égal au déclencheur est permis — c'est un choix, pas une erreur.
 * `false` quand un des deux prix manque : `orderPricesReady` s'en charge.
 */
export function isLimitOnWrongSide(input: {
  isBuy: boolean;
  limitPx: string;
  triggerPx: string;
}): boolean {
  if (!isPositivePrice(input.limitPx) || !isPositivePrice(input.triggerPx)) return false;
  const limit = parseFloat(input.limitPx);
  const trigger = parseFloat(input.triggerPx);
  return input.isBuy ? limit < trigger : limit > trigger;
}
