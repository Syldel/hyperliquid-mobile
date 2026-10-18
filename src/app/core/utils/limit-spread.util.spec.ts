import {
  LIMIT_SPREAD_MARKET,
  LIMIT_SPREAD_SL,
  LIMIT_SPREAD_TP,
  limitSpread,
} from './limit-spread.util';

/**
 * Le prix limite d'un ordre déclencheur est dérivé du déclencheur : c'est lui la décision,
 * le limite n'est que le pire prix accepté. L'écart dépend du type d'ordre (valeurs validées
 * par l'utilisateur le 2026-10-16, voir `order-limit.util.ts`).
 */
describe('limitSpread', () => {
  it('is 10 % for a market trigger, whatever the kind', () => {
    expect(limitSpread('sl', true)).toBe(0.1);
    expect(limitSpread('tp', true)).toBe(0.1);
    expect(LIMIT_SPREAD_MARKET).toBe(0.1);
  });

  it('is wide for a stop loss limit (5 %) and tight for a take profit limit (1.5 %)', () => {
    expect(limitSpread('sl', false)).toBe(LIMIT_SPREAD_SL);
    expect(limitSpread('tp', false)).toBe(LIMIT_SPREAD_TP);
    expect(LIMIT_SPREAD_SL).toBe(0.05);
    expect(LIMIT_SPREAD_TP).toBe(0.015);
  });
});
