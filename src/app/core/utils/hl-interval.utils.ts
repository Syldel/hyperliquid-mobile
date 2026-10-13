import { CandleInterval } from '@syldel/hl-shared-types';
import { ChartInterval } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * ⏱️ HL INTERVAL
 * L'intervalle d'un chart, traduit dans les codes que `/analysis` comprend.
 *
 * Les deux listes ne se recouvrent pas. `CandleInterval` est celle des bougies
 * qu'Hyperliquid sert ; `ChartInterval` est un jeu de codes de fournisseur de
 * données, qui contient des valeurs qu'Hyperliquid ne sert pas (`'45'`,
 * `'180'`, `'3M'`) et qui en **oublie trois qu'il sert** : 8h, 12h et 3d.
 *
 * ⚠️ Cette fonction rabattait ces trois-là sur `'60'` — une heure — avec un
 * `console.warn` pour seule trace. Mesuré dans le navigateur le 2026-10-14 :
 * sélectionner 8H affichait 253 bougies **d'une heure** et le backtest d'une
 * heure avec, sous une étiquette 8H. C'est la défaillance muette que le
 * CLAUDE.md met en premier, sur l'écran où se prend la décision.
 *
 * Elle rend donc `null` plutôt qu'un intervalle inventé, et l'appelant décide
 * quoi en dire. Le chart, lui, continue d'afficher les **vraies** bougies de
 * l'intervalle demandé : Hyperliquid les sert bien (mesuré le 2026-10-14 sur le
 * gateway, bougies de 8 h exactement, grille alignée sur 00:00 / 08:00 / 16:00
 * UTC), c'est seulement l'analyse qui ne sait pas les demander.
 * ============================================================================
 */

/**
 * Le code `/analysis` d'un intervalle de bougie, ou `null` quand il n'en existe
 * aucun.
 *
 * Étendre `ChartInterval` (`'480' | '720' | '3D'`) lèverait la limite et rendrait
 * le backtest disponible sur ces intervalles ; ça reste une tournée de types
 * partagés, et le bot ne saurait toujours pas les **automatiser** — il n'ordonne
 * que `'15' | '60' | '240' | '1D'` (`PASS_SCHEDULES`).
 */
export function chartIntervalFor(interval: CandleInterval): ChartInterval | null {
  const mapping: Record<CandleInterval, ChartInterval | null> = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '1d': '1D',
    '1w': '1W',
    '1M': '1M',
    '8h': null,
    '12h': null,
    '3d': null,
  };

  return mapping[interval];
}
