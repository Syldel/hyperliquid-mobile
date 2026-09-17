import type { StrategyRules } from '@syldel/trading-shared-types';
import { DEFAULT_STRATEGY_BRANCHES, type StrategyBranch } from '../models/strategy-document.model';
import { getAtPath, isLogicalGroup } from './strategy-tree.ops';

/**
 * ============================================================================
 * 🧾 STRATEGY SUMMARY
 * Quelles branches d'une stratégie portent réellement des règles, et comment
 * le dire en une ligne.
 *
 * « Renseignée » veut dire : un `LogicalGroup` avec au moins une condition. Une
 * branche créée puis vidée reste dans l'arbre — `SideRules` impose une `entry`
 * même vide — mais ne compte pas ici : ce résumé décrit ce que la stratégie
 * évalue, pas ce que le document contient.
 *
 * Les branches sont un paramètre plutôt qu'une constante : la bibliothèque
 * locale affiche les quatre branches connues, tandis qu'une paire du bot
 * affiche celles que le catalogue déclare pour la stratégie choisie
 * (`StrategyParameter` de type `rule-builder`).
 * ============================================================================
 */

/** Branches portant au moins une condition, dans l'ordre où elles ont été déclarées. */
export function filledBranches(
  rules: StrategyRules | undefined | null,
  branches: readonly StrategyBranch[] = DEFAULT_STRATEGY_BRANCHES,
): StrategyBranch[] {
  if (!rules) return [];

  return branches.filter((branch) => hasConditions(rules, branch.id));
}

/**
 * Branches sous lesquelles dire qu'un côté **sort dès que son entrée cesse
 * d'être vraie**.
 *
 * C'est ce que fait le moteur du bot quand un côté n'a pas de sortie :
 * `isExit = config.exit ? … : !isEntry` (`StrategyEngineService.executeAdvancedRules`,
 * nest-trading-bot), en backtest comme en live. Sur une condition d'état
 * (`close > EMA(50)`), c'est cohérent : on tient tant que c'est vrai. Sur un
 * événement qui ne dure qu'une bougie (`close crosses above EMA(50)`), chaque
 * trade est refermé à la bougie suivante — et rien ne le laissait deviner.
 *
 * Une sortie créée mais vide compte comme absente : l'enregistrement la retire
 * (`pruneEmptyRuleBranches`), c'est donc bien ce comportement que le bot
 * appliquera.
 *
 * La note se pose sur la branche de sortie quand l'appelant l'affiche, sinon sur
 * celle d'entrée : une stratégie du catalogue peut ne déclarer que des entrées,
 * et le comportement vaut quand même — le taire parce que la branche n'est pas
 * proposée serait précisément le silence qu'on corrige.
 *
 * ⚠️ Ce comportement est une décision du moteur, pas une donnée du catalogue :
 * rien ne le sert à ce build. Si le moteur change, cette note ment — voir
 * docs/strategies/rule-model.md.
 */
export function implicitExitBranchIds(
  rules: StrategyRules | undefined | null,
  branches: readonly StrategyBranch[] = DEFAULT_STRATEGY_BRANCHES,
): string[] {
  if (!rules) return [];

  const offered = new Set(branches.map((branch) => branch.id));
  const annotated: string[] = [];

  // `SideRules` est un type fermé du paquet partagé : c'est de la grammaire,
  // pas du catalogue — les deux côtés ne se découvrent pas à l'exécution.
  for (const side of ['long', 'short'] as const) {
    const entryId = `${side}.entry`;
    const exitId = `${side}.exit`;
    if (!hasConditions(rules, entryId) || hasConditions(rules, exitId)) continue;

    if (offered.has(exitId)) annotated.push(exitId);
    else if (offered.has(entryId)) annotated.push(entryId);
  }

  return annotated;
}

function hasConditions(rules: StrategyRules, branchId: string): boolean {
  const group = getAtPath(rules, `rules.${branchId}`);
  return isLogicalGroup(group) && group.conditions.length > 0;
}

/** Résumé sur une ligne : `Long entry · Long exit`, ou `emptyLabel` si rien n'est renseigné. */
export function branchSummary(
  rules: StrategyRules | undefined | null,
  branches: readonly StrategyBranch[] = DEFAULT_STRATEGY_BRANCHES,
  emptyLabel = 'Draft — no rule yet',
): string {
  const used = filledBranches(rules, branches);
  return used.length > 0 ? used.map((branch) => branch.label).join(' · ') : emptyLabel;
}
