import { isLocallyExecutable } from '../../strategies/domain/strategy-issues.util';
import type { StrategyDocument } from '../../strategies/models/strategy-document.model';

/**
 * ============================================================================
 * 🧮 ATTACHED STRATEGIES
 * Lesquelles des stratégies attachées à un chart partent réellement au
 * backtest, et lesquelles restent à quai.
 *
 * Le filtre existait déjà, dans `fetchViaAnalysis`, et pour une bonne raison :
 * `POST /analysis` valide les stratégies en bloc et rejette **toute** la
 * requête si l'une d'elles n'a rien à évaluer — emportant les indicateurs, qui
 * n'y sont pour rien. Ce qui manquait, c'est de le dire : la puce d'une
 * stratégie retenue était identique à celle d'une stratégie active, et
 * l'absence de signaux se lisait comme « aucun signal sur cette fenêtre »
 * plutôt que comme « celle-ci n'a jamais été évaluée ».
 *
 * D'où une partition, et non un filtre : les deux côtés sortent du **même**
 * appel, donc ce qui est marqué à l'écran ne peut pas diverger de ce qui est
 * envoyé. Deux prédicats à deux endroits auraient fini par ne plus dire la
 * même chose — et c'est précisément cet écart qui produit un affichage faux.
 * ============================================================================
 */

export interface AttachedStrategyPartition {
  /** Jointes à `AnalysisRequest.strategies` : leurs signaux seront tracés. */
  evaluated: StrategyDocument[];
  /** Retenues, faute de quoi la requête entière serait rejetée. À signaler. */
  skipped: StrategyDocument[];
}

/**
 * Le prédicat est `isLocallyExecutable`, donc **la partition du paquet
 * partagé** : seules les anomalies dont ce build est certain retiennent une
 * stratégie. Une valeur qui dépend du catalogue — un indicateur que le bot
 * connaît peut-être et pas nous — part quand même : se taire ici reviendrait à
 * décider à la place du serveur, qui est le seul à faire autorité.
 *
 * L'ordre de chaque côté est celui d'attachement, c'est-à-dire celui de la
 * bande de puces.
 */
export function partitionAttachedStrategies(
  documents: readonly StrategyDocument[],
): AttachedStrategyPartition {
  const evaluated: StrategyDocument[] = [];
  const skipped: StrategyDocument[] = [];

  for (const document of documents) {
    (isLocallyExecutable(document.rules) ? evaluated : skipped).push(document);
  }

  return { evaluated, skipped };
}
