import type { LogicalGroup, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import { locateIssue } from './strategy-issues.util';
import { toLocalIssuePath } from './strategy-path.util';

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
  long: {
    entry: group(comparison(1), {
      type: 'not',
      condition: {
        type: 'comparison',
        left: {
          type: 'arith',
          operator: 'ADD',
          left: { type: 'indicator', name: 'ema', period: 9 },
          right: { type: 'number', value: 1 },
        },
        operator: 'LT',
        right: { type: 'price', field: 'close' },
      },
    } as RuleNode),
    exit: group(),
  },
};

describe('toLocalIssuePath', () => {
  // Le serveur valide une IExchangeStrategy entière, donc situe depuis `strategy`.
  it('strips the prefix the server adds', () => {
    expect(toLocalIssuePath('strategy.rules.long.entry.conditions[0].left')).toBe(
      'rules.long.entry.conditions[0].left',
    );
  });

  it('leaves an already-local path alone', () => {
    expect(toLocalIssuePath('rules.short.exit')).toBe('rules.short.exit');
  });

  // Le serveur situe aussi des anomalies hors de l'arbre : l'appelant doit
  // pouvoir se contenter du message plutôt que de viser un nœud au hasard.
  it('returns null for a path that addresses nothing in the tree', () => {
    expect(toLocalIssuePath('strategy.settings.atrPeriod')).toBeNull();
    expect(toLocalIssuePath('expressions[0].operand')).toBeNull();
    expect(toLocalIssuePath('strategy.shortname')).toBeNull();
  });

  it('refuses anything that is not a usable path', () => {
    expect(toLocalIssuePath(undefined)).toBeNull();
    expect(toLocalIssuePath(42)).toBeNull();
    expect(toLocalIssuePath('')).toBeNull();
    expect(toLocalIssuePath('strategy.rules..long')).toBeNull();
  });

  // `strategy.` n'est retiré qu'en tête, jamais ailleurs.
  it('only strips a leading prefix', () => {
    expect(toLocalIssuePath('rules.long.entry.strategy.x')).toBe('rules.long.entry.strategy.x');
  });
});

describe('locateIssue', () => {
  it('walks up from an operand to the group that contains it', () => {
    expect(locateIssue(RULES, 'strategy.rules.long.entry.conditions[0].left')).toEqual({
      groupPath: 'rules.long.entry',
      nodePath: 'rules.long.entry.conditions[0]',
    });
  });

  // `conditions` est un tableau : le retenir signalerait la liste entière.
  it('never reports the conditions array as the offending line', () => {
    const located = locateIssue(RULES, 'rules.long.entry.conditions[0].right');

    expect(located?.nodePath).toBe('rules.long.entry.conditions[0]');
  });

  it('reports a group that is itself at fault', () => {
    expect(locateIssue(RULES, 'strategy.rules.long.exit')).toEqual({
      groupPath: 'rules.long.exit',
      nodePath: 'rules.long.exit',
    });
  });

  it('stops at the nearest group, not the branch, for a nested condition', () => {
    const located = locateIssue(RULES, 'rules.long.entry.conditions[1].condition.left.left');

    expect(located).toEqual({
      groupPath: 'rules.long.entry',
      nodePath: 'rules.long.entry.conditions[1]',
    });
  });

  // Le verdict serveur peut survivre à une suppression : mieux vaut ne rien
  // désigner que de désigner un voisin.
  it('gives up on a path that no longer matches the tree', () => {
    expect(locateIssue(RULES, 'rules.long.entry.conditions[7].left')).toBeNull();
    expect(locateIssue(RULES, 'rules.short.entry')).toBeNull();
  });

  it('gives up on a path that addresses nothing in the tree', () => {
    expect(locateIssue(RULES, 'strategy.settings.atrPeriod')).toBeNull();
  });

  it('handles being asked before any rules exist', () => {
    expect(locateIssue(undefined, 'strategy.rules.long.entry')).toBeNull();
    expect(locateIssue({}, 'strategy.rules.long.entry')).toBeNull();
  });
});
