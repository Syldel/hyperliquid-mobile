// `import type` et non un import de valeur : le service importe cette
// fonction, et celle-ci importe son type — un cycle. Le `type` s'efface à la
// compilation, donc le cycle n'existe pas à l'exécution.
import type { IndicatorPoint } from '../services/indicator-overlay.service';

/**
 * ============================================================================
 * UNE VALEUR ABSENTE LAISSE UN TROU, ELLE NE DISPARAÎT PAS
 *
 * Extrait une ligne nommée d'une série d'indicateur, sous la forme que
 * lightweight-charts attend. Un point dont la valeur est indéterminée devient
 * un **whitespace** — un temps sans valeur — et non un point supprimé.
 *
 * La différence n'est pas cosmétique : supprimer le point relie les deux bords
 * du trou par une droite, et cette droite se lit comme une valeur. « Pas de
 * valeur ici » doit se voir, pas se déduire.
 *
 * Le cas vient du bot. `SimpleValue.value` est `number | null` dans les types
 * partagés, « jamais comblé par une valeur de repli » — et depuis le
 * 2026-10-05 `bbw` et `bbp` en produisent : sur une bande de Bollinger plate
 * (vingt clôtures identiques, un marché illiquide sans échange), `%B` vaut
 * `0/0`. Ils rendaient auparavant `0.5` et `0`, deux valeurs inventées.
 *
 * Cette logique est une fonction pure, et non une méthode de
 * `IndicatorOverlayService`, pour une raison mesurée : tant qu'elle vivait dans
 * le service, elle n'était pas testable sans un faux graphique, et elle ne
 * l'était pas. C'est la même raison qui a fait sortir `expression-series.util`
 * de son pane.
 *
 * ⚠️ Pas de comptage des trous ici, contrairement à `toExpressionSeries` qui en
 * rend un. Il servirait autant — une règle qui ne se déclenche jamais peut
 * n'avoir aucun autre symptôme qu'une série interrompue — mais il demande de
 * décider qui l'affiche, et l'amorçage initial doit en rester exclu.
 * ============================================================================
 */

/** Point de tracé. `value` absent = interruption volontaire du trait. */
export interface IndicatorFieldPoint {
  time: number;
  value?: number;
}

export function indicatorFieldPoints(
  points: readonly IndicatorPoint[],
  field: string,
): IndicatorFieldPoint[] {
  return points.map((point) => {
    const value = point[field];

    // `Number.isFinite` et pas seulement `typeof === 'number'` : un `NaN` ou un
    // `Infinity` est un nombre pour JavaScript, et tracerait un point.
    return typeof value === 'number' && Number.isFinite(value)
      ? { time: point.time, value }
      : { time: point.time };
  });
}
