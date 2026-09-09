import type { ActiveIndicator } from '@shared/components/indicator-picker/models/indicator.model';
import type { IndicatorRequest } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🔗 INDICATOR SERIES MAP
 * Associe les séries renvoyées par `POST /analysis` aux indicateurs actifs du
 * chart, **par clé de réponse** et non par position.
 *
 * `AnalysisResponse.indicators` est un `Record` : l'ordre de ses clés n'est
 * garanti par rien. L'appariement par index qui existait ici attribuait donc
 * silencieusement la série d'un indicateur à un autre dès que deux indicateurs
 * partageaient la même clé, ou qu'un réordonnancement changeait les positions.
 * Une courbe fausse s'affichait sans le moindre signal d'erreur.
 *
 * `keyOf` est injectée plutôt qu'importée : la clé se reconstruit depuis le
 * catalogue servi par le bot (`BotService.buildIndicatorKey`), ce qui suppose
 * un service — alors que cette fonction, elle, reste pure et testable seule.
 * Elle renvoie `null` quand l'indicateur est absent du catalogue chargé.
 *
 * Deux indicateurs actifs identiques (même nom, mêmes paramètres) résolvent
 * volontairement vers la **même** série : ils désignent le même calcul, le
 * serveur ne le renvoie qu'une fois, et chacun garde son propre style.
 * ============================================================================
 */
export function mapIndicatorSeriesById<T>(
  responseIndicators: Record<string, T>,
  active: readonly ActiveIndicator[],
  keyOf: (request: IndicatorRequest) => string | null,
): Map<string, T> {
  const byId = new Map<string, T>();

  for (const indicator of active) {
    const key = keyOf(indicator.request);
    // Clé introuvable : mieux vaut ne rien afficher que d'afficher la série
    // d'un autre indicateur.
    if (key === null) continue;

    const series = responseIndicators[key];
    if (series === undefined) continue;

    byId.set(indicator.id, series);
  }

  return byId;
}
