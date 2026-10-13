import { CANDLE_INTERVALS, type CandleInterval } from '@syldel/hl-shared-types';
import { candleDurationMs, chartIntervalFor, snapToCandleGrid } from './hl-interval.utils';

/**
 * La règle que ce fichier garde : **ne jamais rendre un intervalle que
 * l'appelant n'a pas demandé.**
 *
 * La version précédente rabattait les intervalles inconnus sur `'60'` avec un
 * `console.warn`. Mesuré dans le navigateur le 2026-10-14 : sélectionner 8H
 * affichait 253 bougies d'une heure et le backtest d'une heure avec, sous une
 * étiquette 8H. Un test de cette règle aurait coûté trois lignes.
 */
describe('chartIntervalFor', () => {
  it('translates the intervals /analysis knows', () => {
    expect(chartIntervalFor('1h')).toBe('60');
    expect(chartIntervalFor('4h')).toBe('240');
    expect(chartIntervalFor('1d')).toBe('1D');
    expect(chartIntervalFor('1M')).toBe('1M');
  });

  it('refuses the three Hyperliquid serves and ChartInterval lacks', () => {
    /**
     * 8h, 12h et 3d sont de vraies bougies — mesurées sur le gateway le
     * 2026-10-14, 8 h exactement, grille alignée sur 00:00 / 08:00 / 16:00 UTC.
     * C'est `ChartInterval` qui n'a pas de code pour elles, et l'écran doit
     * pouvoir le dire plutôt que recevoir une heure sous leur nom.
     */
    expect(chartIntervalFor('8h')).toBeNull();
    expect(chartIntervalFor('12h')).toBeNull();
    expect(chartIntervalFor('3d')).toBeNull();
  });

  it('answers for every interval Hyperliquid serves, with no silent hole', () => {
    // La table est exhaustive par construction (`Record<CandleInterval, …>`),
    // mais rien n'empêcherait d'y écrire `null` partout : ce test dit combien
    // d'intervalles l'analyse couvre réellement.
    const answered = CANDLE_INTERVALS.filter(
      (interval: CandleInterval) => chartIntervalFor(interval) !== null,
    );

    expect(CANDLE_INTERVALS).toHaveLength(14);
    expect(answered).toHaveLength(11);
  });

  it('never answers an interval of a different duration', () => {
    /**
     * Le cœur du défaut : la valeur rendue doit décrire **la même** bougie.
     * Une table qui rendrait `'60'` pour `'4h'` passerait tous les tests
     * ci-dessus.
     */
    const minutesOf: Record<string, number> = {
      '1': 1,
      '3': 3,
      '5': 5,
      '15': 15,
      '30': 30,
      '60': 60,
      '120': 120,
      '240': 240,
      '1D': 1440,
      '1W': 10080,
      '1M': 43200,
    };
    const expected: Record<string, number> = {
      '1m': 1,
      '3m': 3,
      '5m': 5,
      '15m': 15,
      '30m': 30,
      '1h': 60,
      '2h': 120,
      '4h': 240,
      '1d': 1440,
      '1w': 10080,
      '1M': 43200,
    };

    for (const [interval, minutes] of Object.entries(expected)) {
      const code = chartIntervalFor(interval as CandleInterval);
      expect(code).not.toBeNull();
      expect(minutesOf[code as string]).toBe(minutes);
    }
  });
});

/**
 * La fenêtre d'un chart partait de `Date.now() − n jours`, donc elle glissait à
 * la seconde. Ce que ça coûtait n'est pas la date affichée : c'est que la
 * **première bougie** de la fenêtre changeait à l'instant où l'horloge
 * franchissait une ouverture, et avec elle le prix de référence de
 * l'achat-conservation.
 */
describe('snapToCandleGrid', () => {
  // 2026-10-13T19:40:45Z, le relevé qui a servi à mesurer le défaut.
  const T = Date.UTC(2026, 9, 13, 19, 40, 45);

  it('brings an instant back to the opening of its candle', () => {
    expect(new Date(snapToCandleGrid(T, '4h')).toISOString()).toBe('2026-10-13T16:00:00.000Z');
    expect(new Date(snapToCandleGrid(T, '1h')).toISOString()).toBe('2026-10-13T19:00:00.000Z');
    expect(new Date(snapToCandleGrid(T, '1d')).toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('follows the grid Hyperliquid actually serves, which is the epoch', () => {
    /**
     * Mesuré sur le gateway le 2026-10-14 : les bougies 8 h s'ouvrent à
     * 00:00 / 08:00 / 16:00 UTC, les 3 j et les hebdomadaires tombent sur un
     * multiple exact de leur durée. La semaine commence donc le **jeudi**, comme
     * l'époque Unix — et non le lundi, qu'un calendrier ferait supposer.
     */
    expect(new Date(snapToCandleGrid(T, '8h')).toISOString()).toBe('2026-10-13T16:00:00.000Z');
    expect(new Date(snapToCandleGrid(T, '1w')).getUTCDay()).toBe(4);
  });

  it('never moves an instant forward', () => {
    // Vers le bas : la fenêtre peut gagner une bougie, elle n'en perd aucune.
    for (const interval of CANDLE_INTERVALS) {
      expect(snapToCandleGrid(T, interval)).toBeLessThanOrEqual(T);
    }
  });

  it('gives the same window twice within one candle', () => {
    // La propriété qui compte : deux ouvertures de l'écran à une minute d'écart
    // doivent décrire la même fenêtre, donc le même prix de référence.
    expect(snapToCandleGrid(T + 60_000, '4h')).toBe(snapToCandleGrid(T, '4h'));
    expect(snapToCandleGrid(T + 4 * 3_600_000, '4h')).not.toBe(snapToCandleGrid(T, '4h'));
  });

  it('leaves the month alone, having no fixed length', () => {
    // Un mois vaut 28 à 31 jours : poser une grille de 30 jours ferait dériver
    // la borne d'un mois sur l'autre, sans que rien ne le signale.
    expect(snapToCandleGrid(T, '1M')).toBe(T);
    expect(candleDurationMs('1M')).toBeNull();
  });

  it('gives every other interval its real duration', () => {
    expect(candleDurationMs('1m')).toBe(60_000);
    expect(candleDurationMs('4h')).toBe(4 * 3_600_000);
    expect(candleDurationMs('3d')).toBe(3 * 86_400_000);
    expect(candleDurationMs('1w')).toBe(7 * 86_400_000);
  });
});
