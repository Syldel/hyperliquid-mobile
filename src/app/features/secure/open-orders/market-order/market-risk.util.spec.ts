import type { BookWalk } from './market-execution.util';
import { assessMarketRisk, describeFunding, formatPct, type RiskInput } from './market-risk.util';

/** Un BTC calme : spread d'un dollar, mark et oracle au mid, ordre minuscule. */
function calm(overrides: Partial<RiskInput> = {}, walk: Partial<BookWalk> = {}): RiskInput {
  return {
    sz: 0.001,
    bid: 100000,
    ask: 100001,
    mid: 100000.5,
    walk: {
      requestedSz: 0.001,
      fillableSz: 0.001,
      avgPx: 100001,
      depthExhausted: false,
      ...walk,
    },
    markPx: 100000,
    oraclePx: 100010,
    dayNtlVlm: 2_000_000_000,
    ...overrides,
  };
}

function levelOf(input: RiskInput, id: string): string | undefined {
  return assessMarketRisk(input).criteria.find((c) => c.id === id)?.level;
}

describe('assessMarketRisk', () => {
  it('says OK for a small order on a deep, calm market', () => {
    expect(assessMarketRisk(calm()).verdict).toBe('ok');
  });

  it('lets the worst criterion decide: a huge volume does not hide a book that cannot fill', () => {
    const input = calm({}, { fillableSz: 0.0004 });
    expect(levelOf(input, 'fillable')).toBe('high');
    expect(levelOf(input, 'volume')).toBe('ok');
    expect(assessMarketRisk(input).verdict).toBe('high');
  });

  it('flags a wide spread', () => {
    // 0,6 % d'écart entre bid et ask.
    expect(levelOf(calm({ bid: 99700, ask: 100300, mid: 100000 }), 'spread')).toBe('high');
  });

  it('flags a mid far from the mark: the fill would show an immediate loss', () => {
    expect(levelOf(calm({ markPx: 99500 }), 'mid-mark')).toBe('caution');
  });

  it('flags a mark detached from the oracle', () => {
    expect(levelOf(calm({ oraclePx: 102500 }), 'mark-oracle')).toBe('high');
  });

  it('flags an order that is a large share of the 24 h volume', () => {
    expect(levelOf(calm({ dayNtlVlm: 1_000 }), 'volume')).toBe('high');
  });

  it('calls a market without any volume high, not unknown', () => {
    expect(levelOf(calm({ dayNtlVlm: 0 }), 'volume')).toBe('high');
  });

  it('never calls a missing measure OK: it is unknown, and the verdict is at least caution', () => {
    const input = calm({ markPx: null, oraclePx: null, dayNtlVlm: null });
    expect(levelOf(input, 'mid-mark')).toBe('unknown');
    expect(levelOf(input, 'mark-oracle')).toBe('unknown');
    expect(levelOf(input, 'volume')).toBe('unknown');
    expect(assessMarketRisk(input).verdict).toBe('caution');
  });

  it('says the depth is unknown, not empty, when the size goes beyond the visible levels', () => {
    const input = calm({}, { fillableSz: 0.0008, depthExhausted: true });
    expect(levelOf(input, 'fillable')).toBe('unknown');
    expect(levelOf(input, 'impact')).toBe('unknown');
    expect(assessMarketRisk(input).criteria.find((c) => c.id === 'impact')?.value).toContain('≥');
  });

  it('calls nothing fillable high', () => {
    const input = calm({}, { fillableSz: 0, avgPx: null });
    expect(levelOf(input, 'impact')).toBe('high');
    expect(assessMarketRisk(input).verdict).toBe('high');
  });
});

describe('formatPct', () => {
  it('keeps three decimals under 0.1 %, so a tiny value is not written as zero', () => {
    expect(formatPct(0.0042)).toBe('0.004 %');
    expect(formatPct(1.234)).toBe('1.23 %');
  });
});

describe('describeFunding', () => {
  it('says a long pays a positive funding, and a short receives it', () => {
    expect(describeFunding(0.00002, true)).toBe('Funding 0.0020 %/h, you would pay it');
    expect(describeFunding(0.00002, false)).toBe('Funding 0.0020 %/h, you would receive it');
  });

  it('says nothing when the rate is unknown', () => {
    expect(describeFunding(null, true)).toBeNull();
  });
});
