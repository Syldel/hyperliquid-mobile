import {
  childPath,
  formatStrategyPath,
  isPathInside,
  parentPath,
  parseStrategyPath,
} from './strategy-path.util';

describe('parseStrategyPath', () => {
  it('splits keys and array indices, indices as numbers', () => {
    expect(parseStrategyPath('rules.long.entry.conditions[0].left')).toEqual([
      'rules',
      'long',
      'entry',
      'conditions',
      0,
      'left',
    ]);
  });

  it('handles consecutive indices', () => {
    expect(parseStrategyPath('rules.a[1][2]')).toEqual(['rules', 'a', 1, 2]);
  });

  it('returns null on a malformed path', () => {
    expect(parseStrategyPath('rules..long')).toBeNull();
    expect(parseStrategyPath('rules.long[')).toBeNull();
    expect(parseStrategyPath('[0]')).toBeNull();
    expect(parseStrategyPath('')).toBeNull();
  });
});

describe('formatStrategyPath', () => {
  it('round-trips every path produced by the shared validator', () => {
    const paths = [
      'rules',
      'rules.long.entry',
      'rules.long.entry.conditions[0].left',
      'rules.short.exit.conditions[2].condition.target',
      'rules.long.entry.conditions[0].right.args[1].source',
    ];

    for (const path of paths) {
      expect(formatStrategyPath(parseStrategyPath(path)!)).toBe(path);
    }
  });
});

describe('childPath / parentPath', () => {
  it('appends a key or an index', () => {
    expect(childPath('rules.long', 'entry')).toBe('rules.long.entry');
    expect(childPath('rules.long.entry.conditions', 0)).toBe('rules.long.entry.conditions[0]');
  });

  it('drops the last segment, index or key alike', () => {
    expect(parentPath('rules.long.entry.conditions[0]')).toBe('rules.long.entry.conditions');
    expect(parentPath('rules.long.entry')).toBe('rules.long');
  });

  it('returns null at the root', () => {
    expect(parentPath('rules')).toBeNull();
    expect(parentPath('nope..')).toBeNull();
  });
});

describe('isPathInside', () => {
  it('treats a path as inside itself', () => {
    expect(isPathInside('rules.long.entry', 'rules.long.entry')).toBe(true);
  });

  it('recognises a descendant', () => {
    expect(isPathInside('rules.long.entry.conditions[0].left', 'rules.long.entry')).toBe(true);
  });

  it('rejects an ancestor passed as the candidate', () => {
    expect(isPathInside('rules.long', 'rules.long.entry')).toBe(false);
  });

  it('rejects a sibling branch', () => {
    expect(isPathInside('rules.short.entry', 'rules.long.entry')).toBe(false);
  });

  // Le cas qui rend la comparaison par segments obligatoire : en préfixe de
  // chaîne, "conditions[10]" descendrait de "conditions[1]".
  it('does not confuse index 10 with index 1', () => {
    expect(isPathInside('rules.long.entry.conditions[10]', 'rules.long.entry.conditions[1]')).toBe(
      false,
    );
  });

  it('does not confuse a longer key with a prefix key', () => {
    expect(isPathInside('rules.longer.entry', 'rules.long')).toBe(false);
  });

  it('returns false when either path is malformed', () => {
    expect(isPathInside('rules..long', 'rules')).toBe(false);
    expect(isPathInside('rules.long', 'rules..')).toBe(false);
  });
});
