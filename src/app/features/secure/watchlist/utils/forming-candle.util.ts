import type { StrategySignalLayer } from './strategy-markers.util';

/**
 * ============================================================================
 * 🕒 FORMING CANDLE
 * Un signal posé sur une bougie qui n'est pas encore close est provisoire.
 *
 * Hyperliquid renvoie la bougie en cours comme dernière bougie, et ni le gateway
 * ni le bot ne l'écartent (mesuré le 2026-09-17 : dernière bougie 1h de
 * `/analysis` ouverte depuis 28 min). Son `close` est le dernier prix échangé,
 * pas une clôture : une condition vraie à cet instant peut ne plus l'être dans
 * dix minutes, et le marqueur disparaître au rafraîchissement suivant. Sans le
 * dire, ce marqueur se lit comme un signal acquis.
 *
 * Le correctif de fond est côté bot — ne décider que sur des bougies closes (voir
 * docs/roadmap.md). Ce signalement ne devient pas inutile pour autant : le jour où
 * le bot n'émet plus de signal sur la bougie en cours, il ne se déclenche plus, et
 * s'il se déclenchait encore, c'est qu'une régression l'y aurait remis.
 * ============================================================================
 */

/**
 * `openTime` de la dernière bougie si elle est encore en cours à `now`, sinon
 * `null`.
 *
 * Une bougie ouverte à `t` couvre `[t, t + intervalMs[` : elle est close dès que
 * `now` atteint `t + intervalMs` — c'est le `T + 1` d'Hyperliquid.
 *
 * ⚠️ `now` est l'horloge de l'appareil. Une horloge en retard fait juger en
 * cours une bougie close (signalement de trop, sans danger) ; une horloge en
 * avance fait l'inverse, et c'est le cas qui tairait un signal provisoire. Rien
 * ici ne le corrige : `AnalysisCandle` ne porte pas d'heure de clôture servie.
 */
export function formingCandleOpenTime(
  lastCandleOpenTime: number | undefined,
  intervalMs: number,
  now: number,
): number | null {
  if (lastCandleOpenTime === undefined) return null;
  return lastCandleOpenTime + intervalMs > now ? lastCandleOpenTime : null;
}

/**
 * Noms des stratégies ayant émis au moins un signal sur la bougie en cours, dans
 * l'ordre des couches reçues. Rien quand aucune bougie n'est en cours.
 */
export function strategiesSignallingOnFormingCandle(
  layers: readonly Pick<StrategySignalLayer, 'name' | 'signals'>[],
  formingOpenTime: number | null,
): string[] {
  if (formingOpenTime === null) return [];

  return layers
    .filter((layer) => layer.signals.some((signal) => signal.time === formingOpenTime))
    .map((layer) => layer.name);
}
