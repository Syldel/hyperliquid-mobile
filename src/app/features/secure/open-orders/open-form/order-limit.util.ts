import { roundPrice } from '@utils/hl-rounding.utils';

/** L'écart entre le déclencheur et le prix limite d'un ordre déclencheur : 0,1 %. */
export const TRIGGER_OFFSET = 0.001;

export interface LimitFromTriggerInput {
  /** Le formulaire montre un ordre EXISTANT, pas un ordre en cours de création. */
  isModify: boolean;
  /**
   * Le déclencheur que l'ordre existant portait à l'ouverture, ou `null` en création. En
   * modification, un déclencheur **identique** n'est pas une saisie de l'utilisateur : c'est
   * l'ordre tel qu'il est.
   */
  originalTriggerPx: string | null;
  orderKind: 'limit' | 'trigger';
  triggerPx: string;
  isBuy: boolean;
  szDecimals: number;
  isSpot: boolean;
}

/**
 * Le prix limite à proposer pour un ordre déclencheur : le déclencheur ± 0,1 % (au-dessus
 * pour un achat, en dessous pour une vente), arrondi comme l'exchange l'exige. `null` quand il
 * n'y a **rien à proposer**.
 *
 * En modification, il n'y a rien à proposer **tant que le déclencheur est celui de l'ordre** :
 * sans ce garde, ouvrir un ordre déclencheur existant remplaçait son vrai prix limite par celui-ci
 * avant tout geste de l'utilisateur (80000 devenait 81081, mesuré le 2026-10-16). Dès que
 * l'utilisateur CHANGE le déclencheur, le limite suit de nouveau, comme à la création : un
 * premier garde coupait aussi ce comportement, qui existait avant (mesuré, puis corrigé).
 */
export function limitFromTrigger(input: LimitFromTriggerInput): string | null {
  if (input.orderKind !== 'trigger') return null;
  // En modification, tant que le déclencheur est celui de l'ordre, rien à proposer.
  if (input.isModify && input.triggerPx === input.originalTriggerPx) return null;

  const trigger = parseFloat(input.triggerPx);
  if (!trigger) return null;

  const factor = input.isBuy ? 1 + TRIGGER_OFFSET : 1 - TRIGGER_OFFSET;
  return String(parseFloat(roundPrice(trigger * factor, input.szDecimals, input.isSpot)));
}
