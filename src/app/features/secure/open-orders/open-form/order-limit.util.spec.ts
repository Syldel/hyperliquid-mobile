import {
  LIMIT_SPREAD_MARKET,
  LIMIT_SPREAD_SL,
  LIMIT_SPREAD_TP,
  limitFromTrigger,
  limitSpread,
  isPositivePrice,
  orderPricesReady,
  type LimitFromTriggerInput,
} from './order-limit.util';

const create = (overrides: Partial<LimitFromTriggerInput> = {}): LimitFromTriggerInput => ({
  original: null,
  orderKind: 'trigger',
  triggerPx: '81000',
  isMarket: false,
  tpsl: 'sl',
  isBuy: false,
  szDecimals: 3,
  isSpot: false,
  ...overrides,
});

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

describe('limitFromTrigger', () => {
  describe('creating a trigger order', () => {
    it('puts the stop loss limit 5 % below the trigger for a sell', () => {
      expect(limitFromTrigger(create({ tpsl: 'sl', isBuy: false }))).toBe('76950');
    });

    it('puts it 5 % above for a buy', () => {
      expect(limitFromTrigger(create({ tpsl: 'sl', isBuy: true }))).toBe('85050');
    });

    it('uses the tight 1.5 % for a take profit, same direction', () => {
      expect(limitFromTrigger(create({ tpsl: 'tp', isBuy: false }))).toBe('79785');
      expect(limitFromTrigger(create({ tpsl: 'tp', isBuy: true }))).toBe('82215');
    });

    it('uses 10 % for a market trigger, the slippage bound', () => {
      expect(limitFromTrigger(create({ isMarket: true, isBuy: false }))).toBe('72900');
      expect(limitFromTrigger(create({ isMarket: true, isBuy: true }))).toBe('89100');
    });

    it('rounds like the exchange: five significant figures, decimals capped by the size decimals', () => {
      expect(limitFromTrigger(create({ triggerPx: '100', tpsl: 'tp', isBuy: true }))).toBe('101.5');
    });
  });

  describe('modifying an existing order', () => {
    const original = { triggerPx: '81000', isMarket: false, tpsl: 'sl' as const, limitPx: '80000' };

    // La ligne qui manquait : sans elle, c'est ce test qui tombe.
    it("keeps the order's own limit while it is as it was opened — it is shown as it is", () => {
      expect(limitFromTrigger(create({ original }))).toBe('80000');
    });

    // Remettre le déclencheur à sa valeur doit rendre le limite d'origine, pas laisser celui
    // dérivé de la saisie intermédiaire.
    it("gives the order's own limit back when the trigger returns to its original value", () => {
      const edited = limitFromTrigger(create({ original, triggerPx: '82000' }));
      expect(edited).toBe('77900');
      expect(limitFromTrigger(create({ original, triggerPx: '81000' }))).toBe('80000');
    });

    // Le garde ne doit PAS tout couper : changer le déclencheur faisait suivre le limite, et
    // ce comportement était utilisé. Un premier garde le supprimait — mesuré le 2026-10-16.
    it('follows again once the user changes the trigger', () => {
      expect(limitFromTrigger(create({ original, triggerPx: '82000' }))).toBe('77900');
    });

    it('follows when the user switches to a market trigger', () => {
      expect(limitFromTrigger(create({ original, isMarket: true }))).toBe('72900');
    });

    it('follows when the user switches between stop loss and take profit', () => {
      expect(limitFromTrigger(create({ original, tpsl: 'tp' }))).toBe('79785');
    });

    it('compares the trigger as typed: the same text is not a change', () => {
      expect(limitFromTrigger(create({ original, triggerPx: '81000' }))).toBe('80000');
    });
  });

  describe('when there is nothing to derive from', () => {
    it('does nothing for a plain limit order', () => {
      expect(limitFromTrigger(create({ orderKind: 'limit' }))).toBeNull();
    });

    // Un limite resté d'un déclencheur précédent serait celui d'un autre ordre.
    it.each([
      ['empty', ''],
      ['zero', '0'],
      ['text', 'abc'],
      ['negative', '-5'],
    ])('proposes an empty limit for a trigger price that is %s', (_label, triggerPx) => {
      expect(limitFromTrigger(create({ triggerPx }))).toBe('');
    });
  });
});

describe('orderPricesReady', () => {
  const ready = { orderKind: 'limit' as const, limitPx: '81000', triggerPx: '' };

  it('is ready for a limit order with a limit price, no trigger needed', () => {
    expect(orderPricesReady(ready)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['zero', '0'],
    ['text', 'abc'],
    ['negative', '-1'],
  ])('is not ready when the limit price is %s', (_label, limitPx) => {
    expect(orderPricesReady({ ...ready, limitPx })).toBe(false);
  });

  it('needs the trigger as well for a trigger order', () => {
    const trigger = { ...ready, orderKind: 'trigger' as const };
    expect(orderPricesReady({ ...trigger, triggerPx: '' })).toBe(false);
    expect(orderPricesReady({ ...trigger, triggerPx: '80000' })).toBe(true);
  });

  it('needs the limit price of a trigger order too: a trigger alone is not an order', () => {
    expect(orderPricesReady({ orderKind: 'trigger', limitPx: '', triggerPx: '80000' })).toBe(false);
  });
});

describe('isPositivePrice', () => {
  it.each(['1', '0.0001', '81000.5'])('accepts %s', (text) => {
    expect(isPositivePrice(text)).toBe(true);
  });

  it.each(['', '0', '-3', 'abc', 'NaN', 'Infinity'])('refuses "%s"', (text) => {
    expect(isPositivePrice(text)).toBe(false);
  });
});
