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

  return branches.filter((branch) => {
    const group = getAtPath(rules, `rules.${branch.id}`);
    return isLogicalGroup(group) && group.conditions.length > 0;
  });
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
