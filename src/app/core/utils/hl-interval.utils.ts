import { CANDLE_INTERVAL_MINUTES, CandleInterval } from '@syldel/hl-shared-types';
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

/**
 * La durée d'une bougie, ou `null` quand elle n'en a pas de fixe.
 *
 * Seul `1M` est dans ce cas : un mois vaut 28 à 31 jours, et les 43 200 minutes
 * de `CANDLE_INTERVAL_MINUTES` en sont une approximation commode — fausse dès
 * qu'on s'en sert pour poser une grille. Le bot refuse la même valeur pour la
 * même raison (`HlIntervalMapper.candleDurationMs`).
 */
export function candleDurationMs(interval: CandleInterval): number | null {
  if (interval === '1M') return null;
  return CANDLE_INTERVAL_MINUTES[interval] * 60_000;
}

/**
 * Un instant ramené à l'ouverture de la bougie qui le contient.
 *
 * ⚠️ **Ce n'est pas cosmétique.** La fenêtre d'un chart se calculait en
 * `Date.now() − n jours`, donc elle glissait à la seconde : la première bougie
 * de la fenêtre changeait à l'instant où l'horloge franchissait une ouverture,
 * et avec elle le **prix de référence de l'achat-conservation** — mesuré le
 * 2026-10-14 sur BTC en 4 h, deux clôtures consécutives s'écartent de 0,25 % en
 * médiane et jusqu'à 1,25 %. Le `vs hold` affiché sautait donc d'un quart à la
 * moitié de sa valeur sans qu'aucune bougie ne se soit fermée.
 *
 * Calé, ce saut arrive quand une bougie **se ferme**, en même temps qu'une
 * nouvelle apparaît : il reste, mais il s'explique.
 *
 * Vers le bas, jamais vers le haut : la fenêtre peut gagner une bougie, elle
 * n'en perd aucune. Et la grille d'Hyperliquid est bien celle de l'époque Unix —
 * mesuré sur le gateway le 2026-10-14, les bougies 8 h tombent sur 00:00 / 08:00
 * / 16:00 UTC, les 3 j et les 1 s sur un multiple exact de leur durée (la semaine
 * commence donc le **jeudi**, comme l'époque).
 */
export function snapToCandleGrid(time: number, interval: CandleInterval): number {
  const duration = candleDurationMs(interval);
  if (duration === null) return time;
  return Math.floor(time / duration) * duration;
}
