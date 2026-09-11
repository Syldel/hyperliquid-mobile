import type { Operand } from '@syldel/trading-shared-types';
import { isPriceScale, operandScale, resolveNeutral, scaleGroupOf } from './operand-scale.util';

const CATALOGUE = {
  indicatorOverlay: (name: string) =>
    ({ ema: true, sma: true, atr: false, rsi: false })[name] as boolean | undefined,
  transformOutputScale: (kind: string) =>
    ({ zscore: 'zscore', percentile: 'percent', slope: 'sameAsSource' })[kind] as
      | string
      | undefined,
};

const scale = (operand: unknown) => operandScale(operand as Operand, CATALOGUE);

describe('operandScale', () => {
  it('reads a price field on the price scale', () => {
    expect(scale({ type: 'price', field: 'close' })).toEqual({ kind: 'price' });
  });

  it('follows the catalogue for an indicator rather than guessing', () => {
    expect(scale({ type: 'indicator', name: 'ema', period: 9 })).toEqual({ kind: 'price' });
    expect(scale({ type: 'indicator', name: 'rsi', period: 14 })).toEqual({
      kind: 'group',
      group: 'indicator:rsi',
    });
  });

  // Se tromper vers le panneau coûte de la hauteur ; se tromper vers les prix
  // écrase les bougies. L'inconnu va donc dans un panneau.
  it('gives an indicator this build does not know its own pane', () => {
    expect(scale({ type: 'indicator', name: 'brand_new', period: 3 })).toEqual({
      kind: 'group',
      group: 'indicator:brand_new',
    });
  });

  it('leaves a constant neutral, with no scale of its own', () => {
    expect(scale({ type: 'number', value: 2 })).toEqual({ kind: 'neutral' });
  });

  it('groups transforms by the output scale the bot declares', () => {
    const source = { type: 'price', field: 'close' };

    expect(scale({ type: 'transform', kind: 'zscore', period: 200, source })).toEqual({
      kind: 'group',
      group: 'scale:zscore',
    });
    expect(scale({ type: 'transform', kind: 'percentile', period: 50, source })).toEqual({
      kind: 'group',
      group: 'scale:percent',
    });
  });

  it('lets a sameAsSource transform keep its source scale', () => {
    expect(
      scale({
        type: 'transform',
        kind: 'slope',
        period: 20,
        source: { type: 'price', field: 'close' },
      }),
    ).toEqual({ kind: 'price' });
  });

  it('gives an unknown transform its own pane too', () => {
    expect(
      scale({ type: 'transform', kind: 'future', source: { type: 'price', field: 'close' } }),
    ).toEqual({ kind: 'group', group: 'transform:future' });
  });

  describe('arithmetic', () => {
    const sma = { type: 'indicator', name: 'sma', period: 20 };
    const atr = { type: 'indicator', name: 'atr', period: 14 };
    const close = { type: 'price', field: 'close' };

    // C'est une bande de prix, pas une volatilite : elle se lit sur les bougies.
    it('keeps a price level when a volatility is added to it', () => {
      expect(scale({ type: 'arith', operator: 'ADD', left: sma, right: atr })).toEqual({
        kind: 'price',
      });
    });

    it('keeps a price level when it is scaled by a constant', () => {
      expect(
        scale({ type: 'arith', operator: 'MUL', left: close, right: { type: 'number', value: 2 } }),
      ).toEqual({ kind: 'price' });
    });

    // Un prix divise par un prix n'a plus d'unite - le seul cas ou deux prix
    // n'en produisent pas un.
    it('turns a price over a price into a dimensionless ratio', () => {
      expect(scale({ type: 'arith', operator: 'DIV', left: close, right: sma })).toEqual({
        kind: 'group',
        group: 'scale:ratio',
      });
    });

    it('gives two foreign scales a group of their own, stable whatever the order', () => {
      const rsi = { type: 'indicator', name: 'rsi', period: 14 };
      const left = scale({ type: 'arith', operator: 'ADD', left: rsi, right: atr });
      const right = scale({ type: 'arith', operator: 'ADD', left: atr, right: rsi });

      expect(left).toEqual(right);
      expect(scaleGroupOf(left)).toBe('mixed:indicator:atr+indicator:rsi');
    });
  });

  it('takes the scale of the arguments for min/max', () => {
    expect(
      scale({
        type: 'fn',
        kind: 'max',
        args: [
          { type: 'indicator', name: 'ema', period: 9 },
          { type: 'price', field: 'close' },
        ],
      }),
    ).toEqual({ kind: 'price' });
  });
});

describe('isPriceScale', () => {
  it('is true only for the price scale', () => {
    expect(isPriceScale({ kind: 'price' })).toBe(true);
    expect(isPriceScale({ kind: 'group', group: 'scale:zscore' })).toBe(false);
    expect(isPriceScale({ kind: 'neutral' })).toBe(false);
  });
});

describe('resolveNeutral', () => {
  it('hands a constant the scale of its sibling', () => {
    expect(resolveNeutral({ kind: 'neutral' }, { kind: 'price' })).toEqual({ kind: 'price' });
  });

  it('leaves an operand that already has a scale alone', () => {
    expect(resolveNeutral({ kind: 'price' }, { kind: 'group', group: 'scale:zscore' })).toEqual({
      kind: 'price',
    });
  });
});
