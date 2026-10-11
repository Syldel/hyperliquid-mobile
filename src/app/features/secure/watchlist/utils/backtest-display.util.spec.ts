import type { BacktestReport, BacktestStats } from '@syldel/trading-shared-types';
import {
  backtestLimits,
  definedSides,
  equityLines,
  formatPercent,
  formatPriceForDisplay,
  percentTone,
  tradeFocusRange,
} from './backtest-display.util';

/**
 * L'écran n'a pas le droit de recalculer le rapport du bot ; il choisit quoi
 * montrer. Chaque test fixe un de ces choix, là où un mauvais choix ferait lire
 * autre chose que ce que le bot a rapporté.
 */
const H = 3_600_000;

function stats(overrides: Partial<BacktestStats> = {}): BacktestStats {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    winRatePercent: null,
    realizedGrossPercent: 0,
    realizedNetPercent: 0,
    unrealizedGrossPercent: 0,
    unrealizedNetPercent: 0,
    maxDrawdown: { depthPercent: 0, peakTime: null, troughTime: null },
    ...overrides,
  };
}

function report(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    from: H,
    to: 2 * H,
    // Palier taker de base, écrit en clair : un test ne gagne rien à relire
    // la constante du paquet, et il dirait alors la même chose qu'elle.
    feePerSide: 0.00045,
    long: stats(),
    short: stats(),
    total: stats(),
    trades: [],
    openPositions: [],
    carriedIn: [],
    equity: [
      { time: H, long: 1, short: 2, total: 3 },
      { time: 2 * H, long: 4, short: 5, total: 9 },
    ],
    overlap: { candles: 0, firstTime: null },
    anomalies: [],
    ...overrides,
  };
}

describe('backtestLimits', () => {
  const TAKER = 0.00045;
  const MAKER = 0.00015;
  const joined = (fees: readonly number[]) => backtestLimits(fees).join(' ').toLowerCase();

  it('never claims the figures ignore fees when a fee was charged', () => {
    /**
     * Le rapport est net de frais depuis les types partagés 0.27.0, et l'écran
     * l'annonce par une puce « net of fees ». Une note qui dit le contraire,
     * dans le même bloc, est pire qu'une note absente : elle fait lire un brut
     * là où un net est affiché. Constaté dans le navigateur le 2026-10-11.
     */
    expect(joined([TAKER])).not.toMatch(/no fees|without fees|fees are not/);
  });

  it('names the tier the report applied, rather than staying vague', () => {
    // Le point de ce changement : l'écran disait « the trading fees the server
    // applies », ce qu'aucun lecteur ne peut vérifier.
    expect(joined([TAKER])).toContain('net of 0.045% per side');
  });

  it('writes the tier without the tail of a floating-point product', () => {
    /**
     * ⚠️ Le palier de base **tombe juste** : `0.00045 * 100` vaut exactement
     * `0.045`. Éprouver l'arrondi sur lui ne prouve donc rien — la mutation qui
     * retire l'arrondi y survit. Les paliers de volume, eux, ne tombent pas
     * juste : `0.00035 * 100` rend `0.034999999999999996`.
     */
    expect(joined([0.00035])).toContain('0.035% per side');
    expect(joined([0.0007])).toContain('0.07% per side');
  });

  it('says a zero fee is no fee, instead of announcing a net of zero', () => {
    /**
     * Un palier nul est un palier choisi — celui qui isole ce que les frais
     * coûtent. Annoncer « net of 0% » ferait lire un net là où il y a un brut.
     */
    const text = joined([0]);

    expect(text).toContain('no fees charged');
    expect(text).not.toContain('net of 0%');
  });

  it('refuses to name one tier when the strategies on screen carry two', () => {
    /**
     * La note est rendue **une fois** pour toutes les stratégies visibles. En
     * nommer une seule serait faux pour l'autre — et une note fausse est pire
     * qu'une note vague.
     */
    const text = joined([TAKER, MAKER]);

    expect(text).toContain('different tiers per strategy');
    expect(text).toContain('0.015%');
    expect(text).toContain('0.045%');
  });

  it('names a tier once when every strategy carries the same one', () => {
    // Deux rapports au même palier ne sont pas une divergence.
    expect(joined([TAKER, TAKER])).toContain('net of 0.045% per side');
    expect(joined([TAKER, TAKER])).not.toContain('different tiers');
  });

  it('stays vague rather than invent a tier it cannot read', () => {
    /**
     * `buildBacktestReport` refuse un palier non fini ou négatif, donc un
     * rapport ne devrait jamais en porter. L'écran ne doit pas pour autant
     * afficher `NaN%` ni `-1%` : il retombe sur la formulation sans chiffre.
     */
    for (const fees of [[], [Number.NaN], [-1], [Number.POSITIVE_INFINITY]]) {
      expect(joined(fees)).toContain('net of the trading fees the server applies');
    }
  });

  it('still names what is not counted', () => {
    // Le funding et le slippage restent hors de portée : les taire les ferait
    // oublier, et le chiffre serait lu comme un résultat complet.
    for (const fees of [[TAKER], [0], [TAKER, MAKER], []]) {
      expect(joined(fees)).toContain('funding');
      expect(joined(fees)).toContain('slippage');
    }
  });

  it('keeps the three limits that do not depend on the tier', () => {
    expect(backtestLimits([TAKER])).toHaveLength(4);
    expect(joined([TAKER])).toContain('simplified simulation');
    expect(joined([TAKER])).toContain('take-profit / stop-loss');
    expect(joined([TAKER])).toContain('added, not compounded');
  });
});

describe('formatPercent', () => {
  it('always writes the sign of a non-zero value', () => {
    expect(formatPercent(1.234)).toBe('+1.23%');
    expect(formatPercent(-0.4)).toBe('-0.40%');
  });

  // Un −0,001 arrondi à « -0.00% » se lirait comme une perte.
  it('never shows a signed zero', () => {
    expect(formatPercent(-0.001)).toBe('0.00%');
    expect(formatPercent(0)).toBe('0.00%');
  });
});

describe('percentTone', () => {
  it('colours a gain up and a loss down', () => {
    expect(percentTone(1.2)).toBe('up');
    expect(percentTone(-0.4)).toBe('down');
  });

  // Vu sur un rapport réel : +0,005 % affiché « 0.00% » mais coloré en vert.
  it('judges the value as displayed, so a rounded zero stays neutral', () => {
    expect(percentTone(0.004)).toBeNull();
    expect(percentTone(-0.004)).toBeNull();
    expect(percentTone(0)).toBeNull();
  });
});

describe('formatPriceForDisplay', () => {
  it('keeps a readable precision at any price scale', () => {
    expect(formatPriceForDisplay(76438.5)).toBe('76,438.5');
    expect(formatPriceForDisplay(0.0000123456)).toBe('0.0000123456');
  });
});

describe('definedSides', () => {
  it('lists only the sides a strategy has rules for', () => {
    expect(
      definedSides({ long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } }),
    ).toEqual(['LONG']);
    expect(definedSides(undefined)).toEqual([]);
  });
});

describe('equityLines', () => {
  it('draws the total alone when only one side traded', () => {
    const lines = equityLines(report({ long: stats({ trades: 2 }) }), ['LONG', 'SHORT']);

    expect(lines.map((l) => l.id)).toEqual(['total']);
    expect(lines[0]?.points.map((p) => p.value)).toEqual([3, 9]);
  });

  it('adds each side under the total when both sides traded', () => {
    const lines = equityLines(report({ long: stats({ trades: 1 }), short: stats({ trades: 1 }) }), [
      'LONG',
      'SHORT',
    ]);

    expect(lines.map((l) => l.id)).toEqual(['total', 'LONG', 'SHORT']);
  });

  // Le bot ne tient qu'une position par paire : une somme de deux côtés ouverts
  // ensemble ne doit apparaître nulle part, pas même en courbe.
  it('never draws a total when the report refuses one', () => {
    const lines = equityLines(
      report({
        total: null,
        long: stats({ trades: 1 }),
        short: stats({ trades: 1 }),
        equity: [{ time: H, long: 1, short: 2, total: null }],
      }),
      ['LONG', 'SHORT'],
    );

    expect(lines.map((l) => l.id)).toEqual(['LONG', 'SHORT']);
  });

  it('counts a side holding only an open position as active', () => {
    const lines = equityLines(
      report({
        long: stats({ trades: 1 }),
        openPositions: [
          {
            side: 'SHORT',
            entryTime: H,
            entryPrice: 1,
            markTime: 2 * H,
            markPrice: 1,
            unrealizedGrossPercent: 0,
            unrealizedNetPercent: 0,
          },
        ],
      }),
      ['LONG', 'SHORT'],
    );

    expect(lines.map((l) => l.id)).toEqual(['total', 'LONG', 'SHORT']);
  });
});

describe('tradeFocusRange', () => {
  it('frames a short trade with at least ten candles on each side', () => {
    expect(tradeFocusRange({ entryTime: 100 * H, exitTime: 102 * H }, H, 500 * H)).toEqual({
      from: 90 * H,
      to: 112 * H,
    });
  });

  it('frames a long trade with half its duration on each side', () => {
    expect(tradeFocusRange({ entryTime: 100 * H, exitTime: 140 * H }, H, 500 * H)).toEqual({
      from: 80 * H,
      to: 160 * H,
    });
  });

  it('runs an open position to the last candle, never beyond', () => {
    expect(tradeFocusRange({ entryTime: 490 * H, exitTime: null }, H, 500 * H)).toEqual({
      from: 480 * H,
      to: 500 * H,
    });
  });
});
