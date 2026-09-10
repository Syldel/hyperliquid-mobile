import type { LogicalGroup, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import type { StrategyBranch } from '../models/strategy-document.model';
import { branchSummary, filledBranches } from './strategy-summary.util';

function comparison(value: number): RuleNode {
  return {
    type: 'comparison',
    left: { type: 'price', field: 'close' },
    operator: 'GT',
    right: { type: 'number', value },
  };
}

function group(...conditions: RuleNode[]): LogicalGroup {
  return { type: 'logical', operator: 'AND', conditions };
}

const RULES: StrategyRules = {
  long: { entry: group(comparison(1)), exit: group() },
  short: { entry: group(comparison(2)) },
};

describe('filledBranches', () => {
  it('keeps only the branches carrying a condition', () => {
    expect(filledBranches(RULES).map((branch) => branch.id)).toEqual(['long.entry', 'short.entry']);
  });

  // `SideRules` impose une `entry` : ouvrir `short.exit` en premier en crée une
  // vide, qui ne doit pas compter comme une règle.
  it('ignores a branch that exists but holds nothing', () => {
    expect(filledBranches(RULES).map((branch) => branch.id)).not.toContain('long.exit');
  });

  it('follows the order of the branches it was given', () => {
    const reversed: StrategyBranch[] = [
      { id: 'short.entry', label: 'Short entry' },
      { id: 'long.entry', label: 'Long entry' },
    ];

    expect(filledBranches(RULES, reversed).map((branch) => branch.id)).toEqual([
      'short.entry',
      'long.entry',
    ]);
  });

  it('never reports a branch the caller did not ask about', () => {
    const onlyShort: StrategyBranch[] = [{ id: 'short.entry', label: 'Short entry' }];

    expect(filledBranches(RULES, onlyShort).map((branch) => branch.id)).toEqual(['short.entry']);
  });

  it('handles rules that are not there yet', () => {
    expect(filledBranches(undefined)).toEqual([]);
    expect(filledBranches(null)).toEqual([]);
    expect(filledBranches({})).toEqual([]);
  });
});

describe('branchSummary', () => {
  it('joins the labels of the filled branches', () => {
    expect(branchSummary(RULES)).toBe('Long entry · Short entry');
  });

  it('falls back to the label given for an empty strategy', () => {
    expect(branchSummary({}, undefined, 'No rule yet')).toBe('No rule yet');
  });

  it('has a default empty label, so a caller cannot render "undefined"', () => {
    expect(branchSummary({})).toBe('Draft — no rule yet');
  });
});
