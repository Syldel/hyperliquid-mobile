import type { Operand, RuleNode } from '@syldel/trading-shared-types';
import { formatOperand, formatRuleNode, UNSUPPORTED_LABEL } from './strategy-format.util';

describe('formatOperand', () => {
  it('renders price, number and indicator operands', () => {
    expect(formatOperand({ type: 'price', field: 'close' })).toBe('close');
    expect(formatOperand({ type: 'number', value: 42.5 })).toBe('42.5');
    expect(formatOperand({ type: 'indicator', name: 'ema', period: 9 })).toBe('EMA(9)');
  });

  it('renders a sub-field and an offset', () => {
    expect(formatOperand({ type: 'indicator', name: 'adx', period: 14, subField: 'pdi' })).toBe(
      'ADX(14).pdi',
    );
    expect(formatOperand({ type: 'price', field: 'high', offset: 2 })).toBe('high[t-2]');
  });

  it('omits an offset of zero', () => {
    expect(formatOperand({ type: 'price', field: 'low', offset: 0 })).toBe('low');
  });

  // Une période absente n'est jamais complétée par le registre compilé : afficher
  // EMA(9) pour un opérande qui n'en porte pas mentirait si le bot en exécute 12.
  it('renders an indicator without parameters as its bare name', () => {
    expect(formatOperand({ type: 'indicator', name: 'ema' })).toBe('EMA');
    expect(formatOperand({ type: 'indicator', name: 'obv' })).toBe('OBV');
  });

  it('renders nested arith, transform and fn operands', () => {
    const operand = {
      type: 'arith',
      operator: 'MUL',
      left: { type: 'indicator', name: 'atr', period: 14 },
      right: { type: 'number', value: 2 },
    } as unknown as Operand;
    expect(formatOperand(operand)).toBe('(ATR(14) × 2)');

    expect(
      formatOperand({
        type: 'transform',
        kind: 'zscore',
        period: 200,
        source: { type: 'price', field: 'close' },
      }),
    ).toBe('zscore(close, 200)');

    expect(
      formatOperand({
        type: 'transform',
        kind: 'slope',
        source: { type: 'indicator', name: 'ema', period: 20 },
      }),
    ).toBe('slope(EMA(20))');

    expect(
      formatOperand({
        type: 'fn',
        kind: 'max',
        args: [
          { type: 'indicator', name: 'ichimoku', conversionPeriod: 9, subField: 'spanA' },
          { type: 'number', value: 0 },
        ],
      }),
    ).toBe('max(ICHIMOKU(9).spanA, 0)');
  });

  it('falls back to the unsupported label', () => {
    expect(formatOperand({ type: 'wormhole' })).toBe(UNSUPPORTED_LABEL);
    expect(formatOperand(null)).toBe(UNSUPPORTED_LABEL);
  });
});

describe('formatRuleNode', () => {
  it('renders each condition type', () => {
    expect(
      formatRuleNode({
        type: 'comparison',
        left: { type: 'indicator', name: 'rsi', period: 14 },
        operator: 'LTE',
        right: { type: 'number', value: 30 },
      }),
    ).toBe('RSI(14) ≤ 30');

    expect(
      formatRuleNode({
        type: 'cross',
        left: { type: 'indicator', name: 'ema', period: 9 },
        right: { type: 'indicator', name: 'sma', period: 20 },
        direction: 'UP',
      }),
    ).toBe('EMA(9) crosses above SMA(20)');

    expect(
      formatRuleNode({
        type: 'trend',
        target: { type: 'price', field: 'close' },
        direction: 'DOWN',
        period: 5,
      }),
    ).toBe('close ↘ over 5');

    expect(formatRuleNode({ type: 'constant', value: false })).toBe('Always false');
  });

  it('shows a trend mode only when it is not the implicit STRICT', () => {
    const base = {
      type: 'trend',
      target: { type: 'price', field: 'close' },
      direction: 'UP',
      period: 3,
    };
    expect(formatRuleNode({ ...base, mode: 'STRICT' })).toBe('close ↗ over 3');
    expect(formatRuleNode({ ...base, mode: 'NET' })).toBe('close ↗ over 3 (NET)');
  });

  it('joins a logical group with its operator, without wrapping at the root', () => {
    const node = {
      type: 'logical',
      operator: 'AND',
      conditions: [
        { type: 'constant', value: true },
        { type: 'constant', value: false },
      ],
    } as unknown as RuleNode;

    expect(formatRuleNode(node)).toBe('Always true AND Always false');
  });

  it('parenthesises a nested group and summarises beyond maxDepth', () => {
    const nested = {
      type: 'logical',
      operator: 'AND',
      conditions: [
        { type: 'constant', value: true },
        {
          type: 'logical',
          operator: 'OR',
          conditions: [
            { type: 'constant', value: false },
            { type: 'constant', value: true },
          ],
        },
      ],
    } as unknown as RuleNode;

    expect(formatRuleNode(nested)).toBe('Always true AND (Always false OR Always true)');
    expect(formatRuleNode(nested, { maxDepth: 1 })).toBe('Always true AND 2 conditions');
  });

  it('renders an empty group and a negation', () => {
    expect(formatRuleNode({ type: 'logical', operator: 'AND', conditions: [] })).toBe(
      'No condition',
    );
    expect(formatRuleNode({ type: 'not', condition: { type: 'constant', value: true } })).toBe(
      'NOT (Always true)',
    );
  });

  it('renders an unknown node without hiding the rest of the group', () => {
    const node = {
      type: 'logical',
      operator: 'AND',
      conditions: [{ type: 'quantum' }, { type: 'constant', value: true }],
    } as unknown as RuleNode;

    expect(formatRuleNode(node)).toBe(`${UNSUPPORTED_LABEL} AND Always true`);
  });
});

describe('formatRuleNode with the server grammar', () => {
  const cross = {
    type: 'cross',
    left: { type: 'indicator', name: 'ema', period: 9 },
    right: { type: 'indicator', name: 'sma', period: 20 },
    direction: 'UP',
  };

  const grammar = {
    crossDirections: [
      { value: 'UP' as const, label: 'Breaks Above' },
      { value: 'DOWN' as const, label: 'Breaks Below' },
      { value: 'ANY' as const, label: 'Breaks Either Way' },
    ],
  };

  it('prefers the server wording for a cross direction', () => {
    expect(formatRuleNode(cross, { grammar })).toBe('EMA(9) Breaks Above SMA(20)');
  });

  it('falls back to the local wording when no grammar is supplied', () => {
    expect(formatRuleNode(cross)).toBe('EMA(9) crosses above SMA(20)');
  });

  it('falls back when the grammar does not carry that direction', () => {
    expect(formatRuleNode(cross, { grammar: { crossDirections: [] } })).toBe(
      'EMA(9) crosses above SMA(20)',
    );
  });

  it('carries the grammar through nesting', () => {
    const nested = {
      type: 'logical',
      operator: 'AND',
      conditions: [{ type: 'not', condition: cross }],
    };

    expect(formatRuleNode(nested, { grammar })).toBe('NOT (EMA(9) Breaks Above SMA(20))');
  });

  // Les notations mathématiques restent locales : la grammaire ne les touche pas.
  it('keeps mathematical notations local', () => {
    const comparison = {
      type: 'comparison',
      left: { type: 'price', field: 'close' },
      operator: 'GTE',
      right: { type: 'number', value: 5 },
    };

    expect(formatRuleNode(comparison, { grammar })).toBe('close ≥ 5');
  });
});
