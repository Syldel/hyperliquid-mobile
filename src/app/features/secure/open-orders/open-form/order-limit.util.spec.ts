import { limitFromTrigger, TRIGGER_OFFSET, type LimitFromTriggerInput } from './order-limit.util';

const create = (overrides: Partial<LimitFromTriggerInput> = {}): LimitFromTriggerInput => ({
  isModify: false,
  originalTriggerPx: null,
  orderKind: 'trigger',
  triggerPx: '81000',
  isBuy: true,
  szDecimals: 3,
  isSpot: false,
  ...overrides,
});

/**
 * Le prix limite d'un ordre déclencheur est dérivé du déclencheur : déclencheur ± 0,1 %.
 * C'est voulu pour un NOUVEL ordre. Mais l'effet qui l'appliquait n'avait pas de garde
 * `isModify()` : ouvrir la modification d'un ordre déclencheur existant remplaçait son
 * VRAI prix limite (80000) par déclencheur × 1,001 (81081) avant tout geste de
 * l'utilisateur — mesuré le 2026-10-16 sur trois ordres factices. Un « Update order »
 * aurait envoyé un autre limite que celui de l'ordre, sans avertissement.
 */
describe('limitFromTrigger', () => {
  describe('creating a trigger order', () => {
    it('derives the limit from the trigger, 0.1 % above for a buy', () => {
      expect(limitFromTrigger(create({ isBuy: true }))).toBe('81081');
    });

    it('derives it 0.1 % below for a sell', () => {
      expect(limitFromTrigger(create({ isBuy: false }))).toBe('80919');
    });

    it('rounds like the exchange: five significant figures, decimals capped by the size decimals', () => {
      expect(limitFromTrigger(create({ triggerPx: '100', isBuy: true }))).toBe('100.1');
    });

    it('uses the documented offset', () => {
      expect(TRIGGER_OFFSET).toBe(0.001);
    });
  });

  describe('modifying an existing order', () => {
    // La ligne qui manquait : sans elle, c'est ce test qui tombe.
    it("never derives a limit while the trigger is still the order's own — the order is shown as it is", () => {
      expect(limitFromTrigger(create({ isModify: true, originalTriggerPx: '81000' }))).toBeNull();
    });

    it.each([true, false])('whatever the side (isBuy = %s)', (isBuy) => {
      expect(
        limitFromTrigger(create({ isModify: true, originalTriggerPx: '81000', isBuy })),
      ).toBeNull();
    });

    // Le garde ne doit PAS tout couper : en modification, changer le déclencheur faisait
    // suivre le prix limite, et ce comportement était utilisé. Un premier garde le
    // supprimait avec l'écrasement à l'ouverture — mesuré le 2026-10-16.
    it('derives the limit again once the user changes the trigger', () => {
      expect(
        limitFromTrigger(
          create({ isModify: true, originalTriggerPx: '81000', triggerPx: '82000' }),
        ),
      ).toBe('82082');
    });

    it('follows the side too when the trigger was changed', () => {
      expect(
        limitFromTrigger(
          create({ isModify: true, originalTriggerPx: '81000', triggerPx: '82000', isBuy: false }),
        ),
      ).toBe('81918');
    });

    it('compares the trigger as typed: the same text is not a change', () => {
      expect(
        limitFromTrigger(
          create({ isModify: true, originalTriggerPx: '81000', triggerPx: '81000' }),
        ),
      ).toBeNull();
    });
  });

  describe('when there is nothing to derive from', () => {
    it('does nothing for a plain limit order', () => {
      expect(limitFromTrigger(create({ orderKind: 'limit' }))).toBeNull();
    });

    it.each([
      ['empty', ''],
      ['zero', '0'],
      ['text', 'abc'],
    ])('does nothing for a trigger price that is %s', (_label, triggerPx) => {
      expect(limitFromTrigger(create({ triggerPx }))).toBeNull();
    });
  });
});
