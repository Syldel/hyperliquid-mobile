import type { GrammarOption, OperandType } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🪆 OPERAND TYPES
 * Quels types d'opérande proposer à une profondeur d'imbrication donnée.
 *
 * `arith`, `transform` et `fn` contiennent d'autres opérandes ; la validation
 * partagée rejette au-delà d'une certaine profondeur (`ARITH_TOO_DEEP`,
 * `TRANSFORM_TOO_DEEP`, `FN_TOO_DEEP`). Les retirer du sélecteur évite de
 * laisser construire ce que le serveur refusera — un garde-fou d'ergonomie,
 * pas de sûreté : la validation reste seule juge.
 *
 * La liste et ses libellés viennent de la grammaire servie par
 * `/exchanges/meta` ; cette fonction ne fait que la filtrer, sans jamais en
 * inventer une.
 * ============================================================================
 */

/** Types d'opérande qui en contiennent d'autres. */
const COMPOSED_OPERAND_TYPES: readonly OperandType[] = ['arith', 'transform', 'fn'];

/**
 * Un cran sous la limite de `strategy-validation.ts` (6) : on s'arrête avant
 * de l'atteindre plutôt que de la frôler.
 */
export const MAX_OPERAND_NESTING = 5;

export function availableOperandTypes(
  grammarTypes: readonly GrammarOption<OperandType>[],
  depth: number,
  maxNesting: number = MAX_OPERAND_NESTING,
): GrammarOption<OperandType>[] {
  if (depth < maxNesting) return [...grammarTypes];

  return grammarTypes.filter((option) => !COMPOSED_OPERAND_TYPES.includes(option.value));
}
