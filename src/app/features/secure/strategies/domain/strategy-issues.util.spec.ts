import type {
  RuleNode,
  StrategyRules,
  StrategyValidationIssue,
} from '@syldel/trading-shared-types';
import {
  collectEditorIssues,
  hasUnsupportedNodeAt,
  partitionStrategyIssues,
} from './strategy-issues.util';

function issue(code: StrategyValidationIssue['code'], path: string): StrategyValidationIssue {
  return { code, path, message: `${code} at ${path}` };
}

describe('partitionStrategyIssues', () => {
  it('defers catalog-dependent codes, whatever the path', () => {
    const issues = [
      issue('UNKNOWN_INDICATOR', 'rules.long.entry.conditions[0].left'),
      issue('INVALID_TRANSFORM_KIND', 'rules.long.entry.conditions[0].right'),
    ];

    const { blocking, deferred } = partitionStrategyIssues(issues, ['rules.long.entry']);

    expect(blocking).toEqual([]);
    expect(deferred).toHaveLength(2);
  });

  it('always blocks malformed-value codes', () => {
    const issues = [
      issue('INVALID_TREND_PERIOD', 'rules.long.entry.conditions[0]'),
      issue('EMPTY_LOGICAL_CONDITIONS', 'rules.short.entry'),
      issue('INVALID_OFFSET', 'rules.long.entry.conditions[1].left'),
    ];

    const { blocking, deferred } = partitionStrategyIssues(issues, []);

    expect(blocking).toHaveLength(3);
    expect(deferred).toEqual([]);
  });

  it('defers an unrecognised value outside every edited subtree', () => {
    const issues = [issue('UNKNOWN_NODE_TYPE', 'rules.short.entry.conditions[0]')];

    const { blocking, deferred } = partitionStrategyIssues(issues, ['rules.long.entry']);

    expect(blocking).toEqual([]);
    expect(deferred).toHaveLength(1);
  });

  it('blocks the same code when it sits inside what this build just edited', () => {
    const issues = [issue('UNKNOWN_NODE_TYPE', 'rules.long.entry.conditions[0]')];

    const { blocking, deferred } = partitionStrategyIssues(issues, ['rules.long.entry']);

    expect(blocking).toHaveLength(1);
    expect(deferred).toEqual([]);
  });

  it('does not attribute a sibling index to an edited one', () => {
    const issues = [issue('UNKNOWN_OPERAND_TYPE', 'rules.long.entry.conditions[10].left')];

    const { blocking, deferred } = partitionStrategyIssues(issues, [
      'rules.long.entry.conditions[1]',
    ]);

    expect(blocking).toEqual([]);
    expect(deferred).toHaveLength(1);
  });

  it('treats an empty edited-paths list as "this build authored nothing"', () => {
    const issues = [issue('UNKNOWN_CROSS_DIRECTION', 'rules.long.entry.conditions[0]')];

    expect(partitionStrategyIssues(issues).blocking).toEqual([]);
  });
});

describe('collectEditorIssues', () => {
  it('reports nothing on a well-formed tree', () => {
    const rules: StrategyRules = {
      long: {
        entry: {
          type: 'logical',
          operator: 'AND',
          conditions: [
            {
              type: 'comparison',
              left: { type: 'price', field: 'close' },
              operator: 'GT',
              right: { type: 'number', value: 10 },
            },
          ],
        },
      },
    };

    expect(collectEditorIssues(rules).blocking).toEqual([]);
    expect(collectEditorIssues(rules).deferred).toEqual([]);
  });

  it('blocks an empty branch — the draft state, never savable as executable', () => {
    const rules: StrategyRules = {
      long: { entry: { type: 'logical', operator: 'AND', conditions: [] } },
    };

    const { blocking } = collectEditorIssues(rules);
    expect(blocking.map((i) => i.code)).toEqual(['EMPTY_LOGICAL_CONDITIONS']);
    expect(blocking[0].path).toBe('rules.long.entry');
  });

  // Le scénario complet : document écrit par une version plus récente, ouvert ici.
  it('defers a node type this build does not know, and keeps the rest editable', () => {
    const alien = { type: 'quantum', threshold: 3 } as unknown as RuleNode;
    const rules: StrategyRules = {
      long: {
        entry: {
          type: 'logical',
          operator: 'AND',
          conditions: [
            alien,
            {
              type: 'comparison',
              left: { type: 'price', field: 'close' },
              operator: 'GT',
              right: { type: 'number', value: 1 },
            },
          ],
        },
      },
    };

    const { blocking, deferred } = collectEditorIssues(rules, ['rules.long.entry.conditions[1]']);

    expect(blocking).toEqual([]);
    expect(deferred.map((i) => i.code)).toEqual(['UNKNOWN_NODE_TYPE']);
    expect(deferred[0].path).toBe('rules.long.entry.conditions[0]');
  });

  it('handles undefined rules', () => {
    expect(collectEditorIssues(undefined)).toEqual({ blocking: [], deferred: [] });
  });
});

describe('hasUnsupportedNodeAt', () => {
  const issues = [
    issue('UNKNOWN_NODE_TYPE', 'rules.long.entry.conditions[0]'),
    issue('INVALID_TREND_PERIOD', 'rules.long.entry.conditions[1]'),
  ];

  it('reports the subtree carrying the unsupported node, and its ancestors', () => {
    expect(hasUnsupportedNodeAt('rules.long.entry.conditions[0]', issues)).toBe(true);
    expect(hasUnsupportedNodeAt('rules.long.entry', issues)).toBe(true);
  });

  it('ignores a merely malformed node', () => {
    expect(hasUnsupportedNodeAt('rules.long.entry.conditions[1]', issues)).toBe(false);
  });
});
