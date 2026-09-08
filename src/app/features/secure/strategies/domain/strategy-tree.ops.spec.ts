import type { LogicalGroup, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import {
  appendCondition,
  getAtPath,
  isLogicalGroup,
  pruneEmptyRuleBranches,
  removeAtPath,
  replaceAtPath,
} from './strategy-tree.ops';

function comparison(value: number): RuleNode {
  return {
    type: 'comparison',
    left: { type: 'price', field: 'close' },
    operator: 'GT',
    right: { type: 'number', value },
  };
}

function buildRules(): StrategyRules {
  return {
    long: {
      entry: { type: 'logical', operator: 'AND', conditions: [comparison(1), comparison(2)] },
      exit: { type: 'logical', operator: 'OR', conditions: [comparison(3)] },
    },
    short: {
      entry: { type: 'logical', operator: 'AND', conditions: [comparison(4)] },
    },
  };
}

describe('getAtPath', () => {
  it('reads a node addressed by a validator-shaped path', () => {
    const rules = buildRules();
    expect(getAtPath(rules, 'rules.long.entry.conditions[1].right')).toEqual({
      type: 'number',
      value: 2,
    });
  });

  it('returns undefined for a path that leads nowhere', () => {
    const rules = buildRules();
    expect(getAtPath(rules, 'rules.short.exit')).toBeUndefined();
    expect(getAtPath(rules, 'rules.long.entry.conditions[9]')).toBeUndefined();
  });

  it('returns undefined when the path is not rooted at "rules"', () => {
    expect(getAtPath(buildRules(), 'long.entry')).toBeUndefined();
  });
});

describe('replaceAtPath', () => {
  it('replaces the addressed value without mutating the input', () => {
    const rules = buildRules();
    const next = replaceAtPath(rules, 'rules.long.entry.conditions[0].right', {
      type: 'number',
      value: 42,
    });

    expect(getAtPath(next, 'rules.long.entry.conditions[0].right')).toEqual({
      type: 'number',
      value: 42,
    });
    expect(getAtPath(rules, 'rules.long.entry.conditions[0].right')).toEqual({
      type: 'number',
      value: 1,
    });
  });

  // La garantie "verbatim" : ce qui n'a pas été édité n'est pas reconstruit,
  // donc un nœud que ce build ne comprend pas traverse l'édition intact.
  it('keeps untouched subtrees referentially identical', () => {
    const rules = buildRules();
    const next = replaceAtPath(rules, 'rules.long.entry.conditions[0].right', {
      type: 'number',
      value: 42,
    });

    expect(next.short).toBe(rules.short);
    expect(next.long!.exit).toBe(rules.long!.exit);
    expect(next.long!.entry.conditions[1]).toBe(rules.long!.entry.conditions[1]);
  });

  it('carries an unknown node through an edit made elsewhere', () => {
    const alien = { type: 'quantum', threshold: 3 } as unknown as RuleNode;
    const rules: StrategyRules = {
      long: { entry: { type: 'logical', operator: 'AND', conditions: [alien, comparison(1)] } },
    };

    const next = replaceAtPath(rules, 'rules.long.entry.conditions[1].right', {
      type: 'number',
      value: 9,
    });

    expect(next.long!.entry.conditions[0]).toBe(alien);
  });

  it('creates a missing leaf key but never a missing intermediate one', () => {
    const rules = buildRules();

    const withExit = replaceAtPath(rules, 'rules.short.exit', {
      type: 'logical',
      operator: 'AND',
      conditions: [comparison(7)],
    });
    expect(getAtPath(withExit, 'rules.short.exit.conditions[0].right')).toEqual({
      type: 'number',
      value: 7,
    });

    // `rules.long` existe, mais pas `rules.long.nope` : rien n'est fabriqué en chemin.
    const untouched = replaceAtPath(rules, 'rules.long.nope.deep', 1);
    expect(untouched).toBe(rules);
  });

  it('returns the same reference when the path is malformed or unrooted', () => {
    const rules = buildRules();
    expect(replaceAtPath(rules, 'rules..long', 1)).toBe(rules);
    expect(replaceAtPath(rules, 'long.entry', 1)).toBe(rules);
    expect(replaceAtPath(rules, 'rules', 1)).toBe(rules);
  });
});

describe('removeAtPath', () => {
  it('splices an array element and shifts the following ones', () => {
    const rules = buildRules();
    const next = removeAtPath(rules, 'rules.long.entry.conditions[0]');

    expect((next.long!.entry.conditions as RuleNode[]).length).toBe(1);
    expect(getAtPath(next, 'rules.long.entry.conditions[0].right')).toEqual({
      type: 'number',
      value: 2,
    });
  });

  it('deletes an object key', () => {
    const rules = buildRules();
    const next = removeAtPath(rules, 'rules.long.exit');

    expect(next.long!.exit).toBeUndefined();
    expect('exit' in next.long!).toBe(false);
    expect(next.long!.entry).toBe(rules.long!.entry);
  });

  it('is a no-op on an index or key that does not exist', () => {
    const rules = buildRules();
    expect(removeAtPath(rules, 'rules.long.entry.conditions[9]')).toBe(rules);
    expect(removeAtPath(rules, 'rules.short.exit')).toBe(rules);
    expect(removeAtPath(rules, 'rules')).toBe(rules);
  });
});

describe('isLogicalGroup', () => {
  it('accepts a well-formed group', () => {
    expect(isLogicalGroup({ type: 'logical', operator: 'AND', conditions: [] })).toBe(true);
  });

  it('rejects anything else, including a logical node without conditions', () => {
    expect(isLogicalGroup({ type: 'logical', operator: 'AND' })).toBe(false);
    expect(isLogicalGroup(comparison(1))).toBe(false);
    expect(isLogicalGroup(null)).toBe(false);
    expect(isLogicalGroup('logical')).toBe(false);
  });
});

describe('appendCondition', () => {
  it('adds the condition at the end of the group', () => {
    const rules = buildRules();
    const next = appendCondition(rules, 'rules.short.entry', comparison(8));

    const conditions = getAtPath(next, 'rules.short.entry.conditions') as RuleNode[];
    expect(conditions.length).toBe(2);
    expect(conditions[0]).toBe((rules.short!.entry as LogicalGroup).conditions[0]);
    expect(getAtPath(next, 'rules.short.entry.conditions[1].right')).toEqual({
      type: 'number',
      value: 8,
    });
  });

  it('is a no-op when the path does not designate a logical group', () => {
    const rules = buildRules();
    expect(appendCondition(rules, 'rules.long.entry.conditions[0]', comparison(9))).toBe(rules);
    expect(appendCondition(rules, 'rules.short.exit', comparison(9))).toBe(rules);
  });
});

describe('pruneEmptyRuleBranches', () => {
  const empty = { type: 'logical', operator: 'AND', conditions: [] } as LogicalGroup;
  const filled = {
    type: 'logical',
    operator: 'AND',
    conditions: [comparison(1)],
  } as LogicalGroup;

  it('returns the same reference when there is nothing to prune', () => {
    const rules = buildRules();
    expect(pruneEmptyRuleBranches(rules)).toBe(rules);
  });

  it('drops an empty exit but keeps the side', () => {
    const rules: StrategyRules = { long: { entry: filled, exit: empty } };
    const next = pruneEmptyRuleBranches(rules);

    expect(next.long!.entry).toBe(filled);
    expect('exit' in next.long!).toBe(false);
  });

  it('drops a side whose entry is empty and which has no useful exit', () => {
    const rules: StrategyRules = { long: { entry: empty }, short: { entry: filled } };
    const next = pruneEmptyRuleBranches(rules);

    expect(next.long).toBeUndefined();
    expect(next.short).toBe(rules.short);
  });

  // Le cas subtil : jeter le côté ferait perdre le travail fait sur `exit`.
  it('keeps an empty entry when the exit carries conditions', () => {
    const rules: StrategyRules = { long: { entry: empty, exit: filled } };
    const next = pruneEmptyRuleBranches(rules);

    expect(next.long!.entry).toBe(empty);
    expect(next.long!.exit).toBe(filled);
  });

  it('preserves top-level keys this build does not know', () => {
    const rules = {
      long: { entry: empty },
      neutral: { entry: filled },
    } as unknown as StrategyRules;
    const next = pruneEmptyRuleBranches(rules) as Record<string, unknown>;

    expect(next['long']).toBeUndefined();
    expect(next['neutral']).toBe((rules as Record<string, unknown>)['neutral']);
  });
});
