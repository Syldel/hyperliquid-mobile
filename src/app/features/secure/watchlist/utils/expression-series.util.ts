/**
 * ============================================================================
 * 〰️ EXPRESSION SERIES
 * Transforme la série renvoyée par `AnalysisResponse.expressions[id]` en points
 * de chart, en préservant les valeurs indéterminées.
 *
 * C'est le point qui distingue une expression d'un indicateur. Un EMA ou un
 * RSI ne produit rien tant qu'il n'est pas amorcé, puis produit toujours un
 * nombre ; le rendu des indicateurs peut donc filtrer les points non
 * numériques sans rien perdre (voir le commentaire dans
 * `indicator-overlay.service.ts`, qui annonçait ce moment). Une transformation
 * glissante — `zscore`, `percentile` — peut au contraire redevenir `null` en
 * plein milieu d'une série déjà amorcée, sur une fenêtre dégénérée : un
 * écart-type nul n'a pas de z-score.
 *
 * Filtrer ces points-là relierait les deux bords du trou par une droite, et
 * cette droite se lirait comme une valeur. On émet donc un point *whitespace*
 * (un temps sans valeur), que lightweight-charts rend comme une interruption
 * du tracé : « pas de valeur ici » se voit, au lieu de se déduire.
 *
 * Le compte renvoyé avec la série ne retient que les trous **après** le premier
 * point défini. L'amorçage initial — 199 points vides devant un `zscore` sur
 * 200 bougies — est le fonctionnement normal de toute fenêtre glissante ; le
 * compter alarmerait sur ce qui va bien et noierait le seul cas qui mérite un
 * regard : une série déjà partie qui s'interrompt. Une règle qui ne se
 * déclenche jamais peut n'avoir aucun autre symptôme que celui-là.
 * ============================================================================
 */

/** Point de tracé. `value` absent = interruption volontaire du trait. */
export interface ExpressionPoint {
  /** Secondes, comme l'attend lightweight-charts — la conversion se fait ici. */
  time: number;
  value?: number;
}

export interface ExpressionSeries {
  points: ExpressionPoint[];
  /** Trous survenus après le démarrage de la série — l'amorçage n'en fait pas partie. */
  indeterminate: number;
}

/** Point tel que le bot le renvoie : `value` peut être `null` sur une fenêtre dégénérée. */
export interface RawExpressionPoint {
  time: number;
  value?: number | null;
}

export function toExpressionSeries(
  points: readonly RawExpressionPoint[] | undefined | null,
): ExpressionSeries {
  if (!points || points.length === 0) return { points: [], indeterminate: 0 };

  let indeterminate = 0;
  let started = false;

  const mapped = points.map((point) => {
    const time = Math.floor(point.time / 1000);

    if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
      if (started) indeterminate += 1;
      return { time };
    }

    started = true;
    return { time, value: point.value };
  });

  return { points: mapped, indeterminate };
}
