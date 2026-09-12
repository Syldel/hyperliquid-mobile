import type { Operand, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import {
  collectStrategyOperands,
  expressionId,
  stripOperandOffsets,
} from './strategy-operands.util';

const EMA9: Operand = { type: 'indicator', name: 'ema', period: 9 } as unknown as Operand;
const CLOSE: Operand = { type: 'price', field: 'close' };

/** Catalogue minimal, a l'image de ce que sert `/exchanges/meta`. */
const CATALOGUE = {
  indicatorOverlay: (name: string) =>
    ({ ema: true, sma: true, atr: false, rsi: false })[name] as boolean | undefined,
  transformOutputScale: (kind: string) =>
    ({ zscore: 'zscore', slope: 'sameAsSource' })[kind] as string | undefined,
};

function comparison(left: Operand, right: Operand): RuleNode {
  return { type: 'comparison', left, operator: 'GT', right };
}

function group(...conditions: RuleNode[]): RuleNode {
  return { type: 'logical', operator: 'AND', conditions };
}

describe('stripOperandOffsets', () => {
  it('drops the offset while keeping everything else', () => {
    const operand = { type: 'price', field: 'close', offset: 3 } as unknown as Operand;

    expect(stripOperandOffsets(operand)).toEqual({ type: 'price', field: 'close' });
  });

  it('drops it inside an arithmetic expression too', () => {
    const operand = {
      type: 'arith',
      operator: 'ADD',
      left: { type: 'price', field: 'close', offset: 1 },
      right: { type: 'indicator', name: 'atr', period: 14, offset: 2 },
    } as unknown as Operand;

    expect(stripOperandOffsets(operand)).toEqual({
      type: 'arith',
      operator: 'ADD',
      left: { type: 'price', field: 'close' },
      right: { type: 'indicator', name: 'atr', period: 14 },
    });
  });

  it('reaches a transform source and function arguments', () => {
    const transform = {
      type: 'transform',
      kind: 'zscore',
      period: 200,
      offset: 1,
      source: { type: 'price', field: 'close', offset: 4 },
    } as unknown as Operand;
    const fn = {
      type: 'fn',
      kind: 'max',
      args: [{ type: 'price', field: 'high', offset: 2 }, CLOSE],
    } as unknown as Operand;

    expect(stripOperandOffsets(transform)).toEqual({
      type: 'transform',
      kind: 'zscore',
      period: 200,
      source: { type: 'price', field: 'close' },
    });
    expect(stripOperandOffsets(fn)).toEqual({
      type: 'fn',
      kind: 'max',
      args: [{ type: 'price', field: 'high' }, CLOSE],
    });
  });

  it('leaves an operand without offset untouched', () => {
    expect(stripOperandOffsets(CLOSE)).toEqual(CLOSE);
  });
});

describe('expressionId', () => {
  // L'ordre des propriétés diffère entre un opérande construit par l'éditeur et
  // le même relu depuis un JSON : deux ids le feraient tracer deux fois.
  it('does not depend on property order', () => {
    const a = { type: 'indicator', name: 'ema', period: 9 } as unknown as Operand;
    const b = { period: 9, name: 'ema', type: 'indicator' } as unknown as Operand;

    expect(expressionId(a)).toBe(expressionId(b));
  });

  it('ignores the offset, which does not change the series', () => {
    const shifted = { type: 'price', field: 'close', offset: 5 } as unknown as Operand;

    expect(expressionId(shifted)).toBe(expressionId(CLOSE));
  });

  it('separates operands that differ in any meaningful way', () => {
    const ema20 = { type: 'indicator', name: 'ema', period: 20 } as unknown as Operand;

    expect(expressionId(EMA9)).not.toBe(expressionId(ema20));
    expect(expressionId(EMA9)).not.toBe(expressionId(CLOSE));
    expect(expressionId({ type: 'number', value: 2 })).not.toBe(
      expressionId({ type: 'number', value: 3 }),
    );
  });

  it('separates two functions that differ only by argument order', () => {
    const a = { type: 'fn', kind: 'max', args: [EMA9, CLOSE] } as unknown as Operand;
    const b = { type: 'fn', kind: 'max', args: [CLOSE, EMA9] } as unknown as Operand;

    expect(expressionId(a)).not.toBe(expressionId(b));
  });

  it('is a plain string usable as an ExpressionRequest id', () => {
    expect(expressionId(EMA9)).toMatch(/^expr_[0-9a-f]{16}$/);
  });
});

describe('collectStrategyOperands', () => {
  const BRANCHES = [
    { id: 'long.entry', label: 'Long entry' },
    { id: 'long.exit', label: 'Long exit' },
  ];

  it('collects both sides of a comparison', () => {
    const rules: StrategyRules = { long: { entry: group(comparison(EMA9, CLOSE)) as never } };

    expect(collectStrategyOperands(rules, CATALOGUE, BRANCHES).map((e) => e.operand)).toEqual([
      EMA9,
      CLOSE,
    ]);
  });

  // Le cœur du sujet : c'est la somme qu'une règle compare, donc c'est la somme
  // qu'il faut tracer — pas l'EMA et l'ATR séparément.
  it('keeps a composed operand whole instead of descending to its leaves', () => {
    const sum = {
      type: 'arith',
      operator: 'ADD',
      left: { type: 'indicator', name: 'ema', period: 20 },
      right: { type: 'indicator', name: 'atr', period: 14 },
    } as unknown as Operand;
    const rules: StrategyRules = { long: { entry: group(comparison(CLOSE, sum)) as never } };

    const collected = collectStrategyOperands(rules, CATALOGUE, BRANCHES);

    expect(collected).toHaveLength(2);
    expect(collected[1].operand).toEqual(sum);
  });

  it('reports each operand once, listing every branch it appears in', () => {
    const rules: StrategyRules = {
      long: {
        entry: group(comparison(EMA9, CLOSE)) as never,
        exit: group(comparison(CLOSE, EMA9)) as never,
      },
    };

    const collected = collectStrategyOperands(rules, CATALOGUE, BRANCHES);

    expect(collected).toHaveLength(2);
    expect(collected[0].branches).toEqual(['Long entry', 'Long exit']);
  });

  it('sees through logical groups and negations', () => {
    const rules: StrategyRules = {
      long: {
        entry: group(group(comparison(EMA9, CLOSE)), {
          type: 'not',
          condition: comparison(CLOSE, { type: 'number', value: 2 }),
        } as RuleNode) as never,
      },
    };

    expect(collectStrategyOperands(rules, CATALOGUE, BRANCHES).map((e) => e.operand)).toEqual([
      EMA9,
      CLOSE,
      { type: 'number', value: 2 },
    ]);
  });

  it('takes the target of a trend condition', () => {
    const rules: StrategyRules = {
      long: {
        entry: group({
          type: 'trend',
          target: EMA9,
          direction: 'UP',
          period: 3,
        } as unknown as RuleNode) as never,
      },
    };

    expect(collectStrategyOperands(rules, CATALOGUE, BRANCHES).map((e) => e.operand)).toEqual([
      EMA9,
    ]);
  });

  it('never reports a branch the caller did not ask about', () => {
    const rules: StrategyRules = {
      long: { entry: group(comparison(EMA9, CLOSE)) as never },
      short: { entry: group(comparison({ type: 'number', value: 7 }, CLOSE)) as never },
    };

    const collected = collectStrategyOperands(rules, CATALOGUE, BRANCHES);

    expect(collected.map((e) => e.operand)).not.toContainEqual({ type: 'number', value: 7 });
  });

  it('handles a strategy with no rules at all', () => {
    expect(collectStrategyOperands(undefined, CATALOGUE)).toEqual([]);
    expect(collectStrategyOperands(null, CATALOGUE)).toEqual([]);
    expect(collectStrategyOperands({}, CATALOGUE)).toEqual([]);
  });
});

describe('collectStrategyOperands - scale', () => {
  const BRANCHES = [{ id: 'long.entry', label: 'Long entry' }];

  it('puts a price-scale operand on the candles', () => {
    const rules: StrategyRules = { long: { entry: group(comparison(EMA9, CLOSE)) as never } };

    expect(collectStrategyOperands(rules, CATALOGUE, BRANCHES).map((e) => e.scale)).toEqual([
      { kind: 'price' },
      { kind: 'price' },
    ]);
  });

  // Un seuil n'a pas d'unite : il appartient au panneau de ce qu'on lui compare.
  it('gives a constant the scale of what the condition compares it to', () => {
    const zscore = {
      type: 'transform',
      kind: 'zscore',
      period: 200,
      source: CLOSE,
    } as unknown as Operand;
    const rules: StrategyRules = {
      long: { entry: group(comparison(zscore, { type: 'number', value: 2 })) as never },
    };

    const collected = collectStrategyOperands(rules, CATALOGUE, BRANCHES);

    expect(collected[0].scale).toEqual({ kind: 'group', group: 'scale:zscore' });
    expect(collected[1].scale).toEqual({ kind: 'group', group: 'scale:zscore' });
  });

  it('keeps a price threshold on the candles', () => {
    const rules: StrategyRules = {
      long: { entry: group(comparison(CLOSE, { type: 'number', value: 100000 })) as never },
    };

    expect(collectStrategyOperands(rules, CATALOGUE, BRANCHES)[1].scale).toEqual({ kind: 'price' });
  });

  it('treats a price plus a volatility as a price level', () => {
    const band = {
      type: 'arith',
      operator: 'ADD',
      left: { type: 'indicator', name: 'sma', period: 20 },
      right: { type: 'indicator', name: 'atr', period: 14 },
    } as unknown as Operand;
    const rules: StrategyRules = { long: { entry: group(comparison(CLOSE, band)) as never } };

    expect(collectStrategyOperands(rules, CATALOGUE, BRANCHES)[1].scale).toEqual({ kind: 'price' });
  });
});

describe('collectStrategyOperands - soundness', () => {
  const BRANCHES = [{ id: 'long.entry', label: 'Long entry' }];

  it('marks a well-formed operand as sendable', () => {
    const rules: StrategyRules = { long: { entry: group(comparison(EMA9, CLOSE)) as never } };

    expect(collectStrategyOperands(rules, CATALOGUE, BRANCHES).map((e) => e.sound)).toEqual([
      true,
      true,
    ]);
  });

  // Il reste liste - marque, jamais escamote - mais il ne partira pas.
  it('marks a malformed operand, without dropping it from the list', () => {
    const rules: StrategyRules = {
      long: {
        entry: group(
          comparison(CLOSE, { type: 'number', value: 'abc' } as unknown as Operand),
        ) as never,
      },
    };

    const collected = collectStrategyOperands(rules, CATALOGUE, BRANCHES);

    expect(collected).toHaveLength(2);
    expect(collected.map((e) => e.sound)).toEqual([true, false]);
  });
});
