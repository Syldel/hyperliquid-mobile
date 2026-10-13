import { CANDLE_INTERVALS, type CandleInterval } from '@syldel/hl-shared-types';
import { chartIntervalFor } from './hl-interval.utils';

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
