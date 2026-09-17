import type { LogicalGroup, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import type { StrategyBranch } from '../models/strategy-document.model';
import { branchSummary, filledBranches, implicitExitBranchIds } from './strategy-summary.util';

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

// Le moteur du bot sort d'un côté sans sortie dès que son entrée cesse d'être
// vraie. La règle testée ici est « le dire partout où c'est vrai, et seulement
// là ».
describe('implicitExitBranchIds', () => {
  it('flags the exit of a side whose entry has conditions and whose exit has none', () => {
    expect(implicitExitBranchIds({ long: { entry: group(comparison(1)) } })).toEqual(['long.exit']);
  });

  // L'enregistrement retire une sortie vide : le bot appliquera donc la sortie
  // implicite, et la note doit l'annoncer dès la construction.
  it('treats an exit that exists but holds nothing as absent', () => {
    expect(implicitExitBranchIds(RULES)).toEqual(['long.exit', 'short.exit']);
  });

  it('says nothing once the exit carries a condition', () => {
    const rules: StrategyRules = {
      long: { entry: group(comparison(1)), exit: group(comparison(2)) },
    };

    expect(implicitExitBranchIds(rules)).toEqual([]);
  });

  // Sans entrée, il n'y a aucune position à refermer : la note serait fausse.
  it('says nothing about a side whose entry is empty', () => {
    const rules: StrategyRules = { long: { entry: group(), exit: group() } };

    expect(implicitExitBranchIds(rules)).toEqual([]);
  });

  it('judges each side on its own', () => {
    const rules: StrategyRules = {
      long: { entry: group(comparison(1)), exit: group(comparison(2)) },
      short: { entry: group(comparison(3)) },
    };

    expect(implicitExitBranchIds(rules)).toEqual(['short.exit']);
  });

  // Une stratégie du catalogue peut ne déclarer que ses entrées : le moteur sort
  // quand même implicitement, donc la note se replie sur l'entrée plutôt que de
  // disparaître avec la branche.
  it('falls back to the entry branch when the exit branch is not offered', () => {
    const entriesOnly: StrategyBranch[] = [{ id: 'long.entry', label: 'Long Entry Rules' }];

    expect(implicitExitBranchIds({ long: { entry: group(comparison(1)) } }, entriesOnly)).toEqual([
      'long.entry',
    ]);
  });

  it('annotates nothing when neither branch of the side is offered', () => {
    const shortOnly: StrategyBranch[] = [{ id: 'short.entry', label: 'Short entry' }];

    expect(implicitExitBranchIds({ long: { entry: group(comparison(1)) } }, shortOnly)).toEqual([]);
  });

  it('handles rules that are not there yet', () => {
    expect(implicitExitBranchIds(undefined)).toEqual([]);
    expect(implicitExitBranchIds(null)).toEqual([]);
    expect(implicitExitBranchIds({})).toEqual([]);
  });
});
