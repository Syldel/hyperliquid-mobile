import type { BacktestReport, BacktestStats } from '@syldel/trading-shared-types';
import {
  backtestLimits,
  definedSides,
  drawdownWindow,
  equityLines,
  formatDuration,
  formatPercent,
  formatPriceForDisplay,
  percentTone,
  tradeFocusRange,
  underwaterWindow,
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
    payoffRatio: null,
    realizedGrossPercent: 0,
    realizedNetPercent: 0,
    unrealizedGrossPercent: 0,
    unrealizedNetPercent: 0,
    maxDrawdown: { depthPercent: 0, peakTime: null, troughTime: null },
    maxDrawdownIntrabar: { depthPercent: 0, peakTime: null, troughTime: null },
    currentDrawdown: { depthPercent: 0, peakTime: null },
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
    // L'achat-conservation : la référence à battre, plate par défaut pour que
    // les tests qui ne la regardent pas ne la lisent pas non plus.
    hold: {
      returnPercent: 0,
      maxDrawdown: { depthPercent: 0, peakTime: null, troughTime: null },
      maxDrawdownIntrabar: { depthPercent: 0, peakTime: null, troughTime: null },
      currentDrawdown: { depthPercent: 0, peakTime: null },
    },
    exposurePercent: 0,
    trades: [],
    openPositions: [],
    carriedIn: [],
    equity: [
      { time: H, long: 1, short: 2, total: 3, hold: 0 },
      { time: 2 * H, long: 4, short: 5, total: 9, hold: 0 },
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

  it('keeps the four limits that do not depend on the tier', () => {
    expect(backtestLimits([TAKER])).toHaveLength(7);
    expect(joined([TAKER])).toContain('simplified simulation');
    expect(joined([TAKER])).toContain('take-profit / stop-loss');
    expect(joined([TAKER])).toContain('added, not compounded');
    expect(joined([TAKER])).toContain('30 s after');
  });

  it('says the bot fills later than the backtest, and which way it leans', () => {
    /**
     * Le backtest exécute au close de la bougie du signal, le bot 30 s après
     * la frontière. Mesuré le 2026-10-14 sur 162 signaux réels : +1,53 point
     * de base en moyenne **contre** le trade, IC 95 % [0,22 ; 3,00], t = 2,14.
     *
     * Les deux moitiés comptent. Taire l'écart ferait lire le chiffre comme un
     * prix que le bot peut obtenir ; l'annoncer sans dire que son **signe
     * dépend de la stratégie** ferait croire à une taxe constante, alors que
     * la mesure ne porte que sur un croisement de moyennes, donc du momentum.
     */
    const line = backtestLimits([TAKER]).find((l) => l.includes('30 s after'));

    expect(line).toBeDefined();
    expect(line).toMatch(/basis point/i);
    expect(line).toMatch(/depends on the strategy/i);
  });

  it('says the benchmark pays no fee, and what that is worth to it', () => {
    /**
     * Le hold est brut comme chez TradingView et Freqtrade, et l'écart avantage
     * la référence — donc désavantage la stratégie. Le taire ferait lire deux
     * colonnes comptées pareil ; le dire sans le chiffrer ne permettrait pas de
     * corriger de tête. Au palier de base, l'aller-retour épargné vaut 0,09 %.
     */
    expect(joined([TAKER])).toContain('buy and hold pays no fee');
    expect(joined([TAKER])).toContain('0.09%');
    // Deux paliers à l'écran : on ne peut plus nommer un aller-retour unique.
    expect(joined([TAKER, MAKER])).toContain('pays no fee');
    expect(joined([TAKER, MAKER])).not.toContain('0.09%');
  });

  it('says the deeper drawdown is itself a floor, not the truth', () => {
    /**
     * La note annonçait un manque (« the real one is deeper ») tant que l'écran
     * n'avait que la mesure sur clôtures. Les deux sont là depuis les types
     * partagés 0.31.0, et la note doit donc apprendre à les lire — sans laisser
     * croire que la seconde est exacte : son sommet est lu sur la courbe
     * adverse, faute d'ordre connu à l'intérieur d'une bougie.
     */
    const text = joined([TAKER]);

    expect(text).toContain('on candle closes');
    expect(text).toContain("at each candle's worst point");
    expect(text).toContain('lower bound');
  });
});

describe('drawdownWindow', () => {
  it('reports no window when the curve never fell below its peak', () => {
    // Pas de couple sommet/creux : il n'y a rien à dater, et inventer une borne
    // ferait lire une chute là où il n'y en a pas eu.
    expect(drawdownWindow({ depthPercent: 0, peakTime: null, troughTime: null }, H)).toBeNull();
  });

  it('dates the fall from the candle that reached the peak', () => {
    expect(drawdownWindow({ depthPercent: 12, peakTime: 2 * H, troughTime: 5 * H }, H)).toEqual({
      fromTime: 2 * H,
      toTime: 5 * H,
      durationMs: 3 * H,
      fromRangeStart: false,
    });
  });

  it('dates it from the range start when no candle reached the peak', () => {
    /**
     * Le cas courant, et non un bord : depuis les types partagés 0.30.0 le
     * sommet est planché au capital intact, donc une position ouverte sur la
     * première bougie met la courbe sous 1 avant qu'aucun point ne l'ait valu —
     * `peakTime` reste `null` et le sommet est le début de la fenêtre. Rendre ce
     * `null` à un `DatePipe` afficherait le 1er janvier 1970.
     */
    expect(drawdownWindow({ depthPercent: 8, peakTime: null, troughTime: 4 * H }, H)).toEqual({
      fromTime: H,
      toTime: 4 * H,
      durationMs: 3 * H,
      fromRangeStart: true,
    });
  });

  it('reports a zero duration rather than a fall that lasted nothing', () => {
    // Creux sur la première bougie, sommet au début de la fenêtre : la chute
    // s'est jouée **dans** cette bougie. L'écran a cette borne à dire, et une
    // durée de 0 est ce qui la lui fait dire plutôt que d'écrire « 0 min ».
    expect(drawdownWindow({ depthPercent: 0.045, peakTime: null, troughTime: H }, H)).toMatchObject(
      {
        durationMs: 0,
        fromRangeStart: true,
      },
    );
  });
});

describe('underwaterWindow', () => {
  it('dates the peak the curve is still under, and the time since', () => {
    // Le creux courant n'a pas de borne droite dans le rapport : son point de
    // mesure est la dernière bougie, et c'est elle qu'on lui donne.
    expect(underwaterWindow({ depthPercent: 6.88, peakTime: 2 * H }, H, 5 * H)).toEqual({
      fromTime: 2 * H,
      toTime: 5 * H,
      durationMs: 3 * H,
      fromRangeStart: false,
    });
  });

  it('says nothing when the curve is back at its peak', () => {
    expect(underwaterWindow({ depthPercent: 0, peakTime: 2 * H }, H, 5 * H)).toBeNull();
  });

  it('stays quiet on a fall too small to show, like its tone does', () => {
    /**
     * `percentTone` tient déjà cette règle : un recul de 0,004 % s'affiche
     * `0.00%`. Annoncer un compte « encore sous son sommet » à côté d'un zéro
     * ferait lire une alerte que le chiffre dément.
     */
    expect(underwaterWindow({ depthPercent: 0.004, peakTime: 2 * H }, H, 5 * H)).toBeNull();
  });

  it('falls back on the range start when no candle reached that peak', () => {
    // Même règle que pour le maximum : `peakTime` à `null` désigne le début de
    // la fenêtre, jamais une absence de sommet.
    expect(underwaterWindow({ depthPercent: 3, peakTime: null }, H, 4 * H)).toMatchObject({
      fromTime: H,
      fromRangeStart: true,
      durationMs: 3 * H,
    });
  });

  it('refuses to date anything on a window without a last candle', () => {
    // `BacktestReport.to` est nul quand la fenêtre n'a aucune bougie : il n'y a
    // alors pas d'instant présent à opposer au sommet.
    expect(underwaterWindow({ depthPercent: 3, peakTime: H }, H, null)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('writes at most two units', () => {
    expect(formatDuration(2 * 24 * H + 12 * H + 30 * 60_000)).toBe('2 d 12 h');
    expect(formatDuration(4 * H + 30 * 60_000)).toBe('4 h 30 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
  });

  it('drops a unit worth zero instead of writing it', () => {
    expect(formatDuration(3 * 24 * H)).toBe('3 d');
    expect(formatDuration(5 * H)).toBe('5 h');
  });

  it('never rounds a span down to no time at all', () => {
    // Aucune bougie ne dure moins d'une minute : une telle durée vient d'un
    // intervalle qu'Hyperliquid ne sert pas, et « 0 min » le nierait.
    expect(formatDuration(30_000)).toBe('< 1 min');
    expect(formatDuration(0)).toBe('< 1 min');
  });

  it('leaves a visible hole rather than inventing a duration', () => {
    // Une durée négative ou non finie ne peut venir que d'un rapport
    // incohérent ; « -2 d » se lirait comme une mesure.
    for (const impossible of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDuration(impossible)).toBe('?');
    }
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
  it('always draws the benchmark, whatever the strategy did', () => {
    /**
     * « Ne rien faire » est la référence à battre. Une courbe qui monte seule à
     * l'écran se lit comme un succès, même quand le cours qu'elle suit a fait
     * mieux — c'est pour ça que celle-ci n'est jamais optionnelle.
     *
     * Elle vient du rapport (`equity[].hold`, types partagés 0.33.0) : l'app ne
     * la calcule pas, elle la lit, comme tout le reste de cet écran.
     */
    const lines = equityLines(
      report({
        equity: [
          { time: H, long: 1, short: 2, total: 3, hold: 5 },
          { time: 2 * H, long: 4, short: 5, total: 9, hold: 12 },
        ],
      }),
      ['LONG'],
    );

    expect(lines.at(-1)?.id).toBe('hold');
    expect(lines.at(-1)?.points.map((p) => p.value)).toEqual([5, 12]);
  });

  it('draws the total alone when only one side traded', () => {
    const lines = equityLines(report({ long: stats({ trades: 2 }) }), ['LONG', 'SHORT']);

    expect(lines.map((l) => l.id)).toEqual(['total', 'hold']);
    expect(lines[0]?.points.map((p) => p.value)).toEqual([3, 9]);
  });

  it('adds each side under the total when both sides traded', () => {
    const lines = equityLines(report({ long: stats({ trades: 1 }), short: stats({ trades: 1 }) }), [
      'LONG',
      'SHORT',
    ]);

    expect(lines.map((l) => l.id)).toEqual(['total', 'LONG', 'SHORT', 'hold']);
  });

  // Le bot ne tient qu'une position par paire : une somme de deux côtés ouverts
  // ensemble ne doit apparaître nulle part, pas même en courbe.
  it('never draws a total when the report refuses one', () => {
    const lines = equityLines(
      report({
        total: null,
        long: stats({ trades: 1 }),
        short: stats({ trades: 1 }),
        equity: [{ time: H, long: 1, short: 2, total: null, hold: 0 }],
      }),
      ['LONG', 'SHORT'],
    );

    expect(lines.map((l) => l.id)).toEqual(['LONG', 'SHORT', 'hold']);
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

    expect(lines.map((l) => l.id)).toEqual(['total', 'LONG', 'SHORT', 'hold']);
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
