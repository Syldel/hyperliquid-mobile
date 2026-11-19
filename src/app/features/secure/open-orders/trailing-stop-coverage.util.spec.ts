import { describe, expect, it } from 'vitest';
import { trailingCoverage, type TrailingCoverageInput } from './trailing-stop-coverage.util';

// La position longue de xyz:BRENTOIL du 2026-11-19 : 0,15, grille à deux décimales.
const base: TrailingCoverageInput = {
  positionSzi: '0.15',
  szDecimals: 2,
  trailings: [],
  excludeOid: null,
  newSz: '',
};

describe('trailingCoverage', () => {
  it('says nothing when no other trailing stop is open on the pair', () => {
    expect(trailingCoverage({ ...base, newSz: '0.15' })).toBeNull();
  });

  it('gives the uncovered size as the rest, for the next tier', () => {
    const c = trailingCoverage({ ...base, trailings: [{ oid: 1, sz: '0.07' }] });
    expect(c).toMatchObject({ kind: 'read', rest: '0.08', over: false });
    expect(c!.text).toBe('Trailing stops cover 0.07 of 0.15 (47 %) · 0.08 left.');
  });

  it('adds sizes on the size grid, not in floating point', () => {
    // 0.1 + 0.2 vaut 0.30000000000000004 en flottant : la somme exacte ne dépasse pas une position de 0,3.
    const c = trailingCoverage({
      ...base,
      positionSzi: '0.3',
      trailings: [
        { oid: 1, sz: '0.1' },
        { oid: 2, sz: '0.2' },
      ],
    });
    expect(c).toMatchObject({ kind: 'read', rest: '', over: false });
  });

  it('reads a short position by its size, not its sign', () => {
    const c = trailingCoverage({
      ...base,
      positionSzi: '-0.15',
      trailings: [{ oid: 1, sz: '0.05' }],
    });
    expect(c).toMatchObject({ rest: '0.1', over: false });
  });

  it('counts the new size, and flags only a sum beyond the position', () => {
    const exact = trailingCoverage({ ...base, trailings: [{ oid: 1, sz: '0.07' }], newSz: '0.08' });
    expect(exact).toMatchObject({ over: false });
    expect(exact!.text).toContain('With this one: 0.15 (100 %).');

    const beyond = trailingCoverage({
      ...base,
      trailings: [{ oid: 1, sz: '0.07' }],
      newSz: '0.15',
    });
    expect(beyond).toMatchObject({ over: true });
    expect(beyond!.text).toContain('With this one: 0.22 (147 %): more than the position.');
  });

  it('flags trailing stops that already cover more than the position', () => {
    const c = trailingCoverage({
      ...base,
      trailings: [
        { oid: 1, sz: '0.15' },
        { oid: 2, sz: '0.15' },
      ],
    });
    expect(c).toMatchObject({ rest: '', over: true });
    expect(c!.text).toBe('Trailing stops cover 0.3 of 0.15 (200 %): more than the position.');
  });

  it('leaves out the trailing stop being replaced, since it is about to be cancelled', () => {
    const c = trailingCoverage({
      ...base,
      trailings: [
        { oid: 1, sz: '0.07' },
        { oid: 2, sz: '0.08' },
      ],
      excludeOid: 2,
      newSz: '0.08',
    });
    expect(c).toMatchObject({ over: false });
    expect(c!.text).toBe(
      'The other trailing stops cover 0.07 of 0.15 (47 %) · 0.08 left. With this one: 0.15 (100 %).',
    );
    // Seul l'ancien sur la paire : rien d'autre à additionner.
    expect(
      trailingCoverage({ ...base, trailings: [{ oid: 2, sz: '0.15' }], excludeOid: 2 }),
    ).toBeNull();
  });

  // Un stop-loss remplacé n'est pas un trailing : aucun n'est écarté, ce ne sont pas « les autres ».
  it('says trailing stops, not the other ones, when the replaced order is not one of them', () => {
    const c = trailingCoverage({ ...base, trailings: [{ oid: 1, sz: '0.07' }], excludeOid: 99 });
    expect(c!.text).toBe('Trailing stops cover 0.07 of 0.15 (47 %) · 0.08 left.');
  });

  it('ignores an empty or unreadable new size instead of guessing it', () => {
    for (const newSz of ['', '  ', 'abc']) {
      const c = trailingCoverage({ ...base, trailings: [{ oid: 1, sz: '0.07' }], newSz });
      expect(c!.text).not.toContain('With this one');
    }
  });

  it('says the coverage is unknown when a size cannot be read', () => {
    const c = trailingCoverage({ ...base, trailings: [{ oid: 1, sz: 'NaN' }] });
    expect(c).toMatchObject({ kind: 'unreadable' });
  });
});
