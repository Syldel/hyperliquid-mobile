import { STRATEGY_COLORS, strategyColor } from './strategy-color.util';

describe('strategyColor', () => {
  // La stabilité est le point : une couleur qui changerait d'un rendu à
  // l'autre déferait le lien entre une pastille de chip et ses marqueurs.
  it('always gives the same colour to the same id', () => {
    expect(strategyColor('st_abc')).toBe(strategyColor('st_abc'));
  });

  it('always picks from the palette', () => {
    const ids = ['st_1', 'st_2', 'st_abc', 'st_' + 'x'.repeat(50), 'a'];
    for (const id of ids) {
      expect(STRATEGY_COLORS).toContain(strategyColor(id));
    }
  });

  it('spreads a handful of ids over several colours rather than collapsing them', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `st_${index}`);
    const distinct = new Set(ids.map(strategyColor));

    expect(distinct.size).toBeGreaterThan(1);
  });

  it('handles an empty id without throwing', () => {
    expect(STRATEGY_COLORS).toContain(strategyColor(''));
  });

  it('offers more than a handful, so two attached strategies rarely collide', () => {
    expect(STRATEGY_COLORS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(STRATEGY_COLORS).size).toBe(STRATEGY_COLORS.length);
  });
});

/**
 * ============================================================================
 * Les invariants **mesurés** de la palette.
 *
 * Le test qu'ils remplacent comparait des chaînes — « la palette ne contient
 * pas #2dd36f » — et c'est précisément ce qui a laissé passer trois défauts
 * pendant des mois : #ffb74d n'était pas #ffc409 et s'en trouvait pourtant à
 * ΔE2000 8,8, et quatre couleurs tombaient sous 3:1 sur le fond clair. Une
 * égalité de chaîne ne mesure rien.
 *
 * L'appareil de mesure vit donc ici, et il se **contrôle lui-même** : une
 * implémentation fausse validerait n'importe quelle palette.
 * ============================================================================
 */
type Rgb = [number, number, number];

/** Les fonds du chart, relevés dans le navigateur le 2026-10-15. */
const FOND_SOMBRE: Rgb = [29, 29, 29];
const FOND_CLAIR: Rgb = [254, 255, 255];

/** Ce qui porte déjà un sens sur ce chart, et qu'une identité ne doit pas imiter. */
const COULEURS_DU_CHART: Record<string, string> = {
  '#2dd36f': 'bullish candle and LONG band',
  '#eb445a': 'bearish candle and SHORT band',
  '#ffc409': 'overlap warning',
};

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function lab([r, g, b]: Rgb): [number, number, number] {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const rl = channel(r);
  const gl = channel(g);
  const bl = channel(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 — la seule distance qui corresponde à ce que l'œil sépare. */
function deltaE2000(hexA: string, hexB: string): number {
  const [l1, a1, b1] = lab(rgb(hexA));
  const [l2, a2, b2] = lab(rgb(hexB));
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const angle = (b: number, a: number) =>
    a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360;
  const hp1 = angle(b1, ap1);
  const hp2 = angle(b2, ap2);

  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * rad) / 2);

  const lBar = (l1 + l2) / 2;
  const cpBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(hp1 - hp2) <= 180) hBar = (hp1 + hp2) / 2;
    else hBar = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cpBar;
  const sH = 1 + 0.015 * cpBar * t;
  const rT =
    -Math.sin(2 * (30 * Math.exp(-(((hBar - 275) / 25) ** 2))) * rad) *
    (2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7)));

  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
}

describe('the palette, measured', () => {
  it('measures what it claims to measure', () => {
    /**
     * Le contrôle de l'instrument, et il n'est pas décoratif : un CIEDE2000
     * faux validerait n'importe quelle palette et ce fichier ne garderait plus
     * rien. La première valeur est celle du relevé — l'ancienne paire de
     * violets, celle qui a déclenché toute cette correction.
     */
    expect(deltaE2000('#ba68c8', '#9575cd')).toBeCloseTo(9.0, 1);
    expect(deltaE2000('#123456', '#123456')).toBe(0);
    expect(deltaE2000('#0397d9', '#aa4d01')).toBeGreaterThan(50);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });

  it('keeps every colour legible on both chart backgrounds', () => {
    /**
     * Le fond du chart vaut #1d1d1d en sombre et #feffff en clair. Un marqueur
     * est un objet graphique porteur de sens : 3:1 (WCAG 1.4.11). La palette
     * précédente descendait à 1,73 sur le clair, pour quatre de ses huit
     * couleurs — elle avait été choisie pour un seul des deux thèmes.
     */
    for (const hex of STRATEGY_COLORS) {
      expect([hex, contrast(rgb(hex), FOND_SOMBRE)]).toSatisfy(
        ([, value]: [string, number]) => value >= 3,
      );
      expect([hex, contrast(rgb(hex), FOND_CLAIR)]).toSatisfy(
        ([, value]: [string, number]) => value >= 3,
      );
    }
  });

  it('keeps two colours far enough apart to tell two strategies apart', () => {
    /**
     * Sur le chart, la couleur est le **seul** identifiant : les marqueurs ne
     * portent aucun libellé, et c'est une décision — une version antérieure
     * écrivait « EMA/SMA cross EXIT LONG » sur chacun, illisible sur téléphone.
     *
     * L'ancienne palette descendait à 9,0. Le seuil de 15 est sous le relevé
     * (15,8) pour laisser respirer un ajout futur, pas pour autoriser un retour
     * en arrière.
     */
    for (let i = 0; i < STRATEGY_COLORS.length; i++) {
      for (let j = i + 1; j < STRATEGY_COLORS.length; j++) {
        const pair = `${STRATEGY_COLORS[i]} / ${STRATEGY_COLORS[j]}`;
        expect([pair, deltaE2000(STRATEGY_COLORS[i]!, STRATEGY_COLORS[j]!)]).toSatisfy(
          ([, distance]: [string, number]) => distance >= 15,
        );
      }
    }
  });

  it('never comes near a colour that already means something here', () => {
    /**
     * Le test que celui-ci remplace vérifiait une **égalité de chaîne**, ce qui
     * ne mesure rien : #ffb74d n'était pas #ffc409 et s'en trouvait pourtant à
     * ΔE2000 8,8 — une identité de stratégie à deux doigts de l'ambre qui
     * signale un chevauchement.
     */
    for (const hex of STRATEGY_COLORS) {
      for (const [reserved, role] of Object.entries(COULEURS_DU_CHART)) {
        expect([`${hex} vs ${role}`, deltaE2000(hex, reserved)]).toSatisfy(
          ([, distance]: [string, number]) => distance >= 25,
        );
      }
    }
  });
});
