import { figureChanges, RECHECK_PRICE_TOLERANCE } from './market-recheck.util';

describe('figureChanges', () => {
  const before = { worstPx: '73000', verdict: 'ok' as const };

  it('finds nothing when the worst price moved within the tolerance and the risk held', () => {
    // 73 000 × 0,1 % = 73 : 73 070 reste dedans.
    expect(figureChanges(before, { worstPx: '73070', verdict: 'ok' })).toEqual([]);
  });

  it('asks again when the worst price moved beyond the tolerance, either way', () => {
    expect(RECHECK_PRICE_TOLERANCE).toBe(0.001);
    expect(figureChanges(before, { worstPx: '73080', verdict: 'ok' })).toEqual([
      { id: 'worst-price', text: 'worst price 73000 → 73080' },
    ]);
    expect(figureChanges(before, { worstPx: '72920', verdict: 'ok' }).map((c) => c.id)).toEqual([
      'worst-price',
    ]);
  });

  it('asks again when the risk got worse', () => {
    expect(figureChanges(before, { worstPx: '73000', verdict: 'high' })).toEqual([
      { id: 'verdict', text: 'risk OK → High' },
    ]);
  });

  // Un verdict meilleur ne rend pas l'ordre plus risqué que ce qui a été accepté.
  it('does not ask again when the risk got better', () => {
    expect(
      figureChanges({ worstPx: '73000', verdict: 'caution' }, { worstPx: '73000', verdict: 'ok' }),
    ).toEqual([]);
  });

  it('treats an unreadable price as a change: nothing sends on a price it cannot compare', () => {
    expect(figureChanges(before, { worstPx: 'NaN', verdict: 'ok' }).map((c) => c.id)).toEqual([
      'worst-price',
    ]);
  });
});
