import type { GrammarOption, OperandType } from '@syldel/trading-shared-types';
import { availableOperandTypes, MAX_OPERAND_NESTING } from './operand-types.util';

const GRAMMAR: GrammarOption<OperandType>[] = [
  { value: 'indicator', label: 'Technical Indicator' },
  { value: 'price', label: 'Market Data / Price Field' },
  { value: 'number', label: 'Static Value (Constant)' },
  { value: 'arith', label: 'Arithmetic Expression' },
  { value: 'transform', label: 'Rolling Transform' },
  { value: 'fn', label: 'Function' },
];

describe('availableOperandTypes', () => {
  it('offers everything the grammar declares at the top level', () => {
    expect(availableOperandTypes(GRAMMAR, 0)).toEqual(GRAMMAR);
  });

  it('keeps offering everything just below the limit', () => {
    expect(availableOperandTypes(GRAMMAR, MAX_OPERAND_NESTING - 1)).toEqual(GRAMMAR);
  });

  // Au-delà, la validation partagée rejetterait un opérande composé de plus.
  it('drops the composed types once the nesting limit is reached', () => {
    const types = availableOperandTypes(GRAMMAR, MAX_OPERAND_NESTING).map((o) => o.value);

    expect(types).toEqual(['indicator', 'price', 'number']);
  });

  it('keeps dropping them deeper still', () => {
    const types = availableOperandTypes(GRAMMAR, MAX_OPERAND_NESTING + 3).map((o) => o.value);

    expect(types).not.toContain('arith');
    expect(types).not.toContain('transform');
    expect(types).not.toContain('fn');
  });

  it('preserves the order and labels the server sent', () => {
    const result = availableOperandTypes(GRAMMAR, 0);

    expect(result.map((o) => o.label)).toEqual(GRAMMAR.map((o) => o.label));
  });

  // La grammaire vient du serveur : un type qu'on ne connaît pas encore ne doit
  // pas être filtré au hasard.
  it('leaves an unknown future type alone', () => {
    const withFuture = [
      ...GRAMMAR,
      { value: 'quantum' as OperandType, label: 'Quantum Thing' },
    ];

    expect(availableOperandTypes(withFuture, MAX_OPERAND_NESTING).map((o) => o.value)).toContain(
      'quantum',
    );
  });

  it('returns a copy rather than the grammar array itself', () => {
    expect(availableOperandTypes(GRAMMAR, 0)).not.toBe(GRAMMAR);
  });

  it('handles an empty grammar (metadata not loaded yet)', () => {
    expect(availableOperandTypes([], 0)).toEqual([]);
  });
});
