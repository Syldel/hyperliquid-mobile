import type {
  ComparisonCondition,
  ConstantCondition,
  CrossCondition,
  IndicatorOperand,
  LogicalGroup,
  LogicalOperator,
  NotCondition,
  Operand,
  PriceField,
  RuleNode,
  TrendCondition,
} from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🏗️ STRATEGY NODE FACTORY
 * Nœuds et opérandes « neufs », prêts à être insérés dans un arbre.
 *
 * Règle de conception : un nœud fraîchement créé est **structurellement
 * valide** dès sa création — pas de champ laissé vide qui ferait apparaître
 * une anomalie avant même que l'utilisateur ait touché à quoi que ce soit. La
 * seule exception assumée est `createLogicalGroup()`, dont un groupe vide est
 * précisément l'état de départ d'une branche en cours de construction (voir
 * `EMPTY_LOGICAL_CONDITIONS` et la décision « brouillon autorisé »).
 *
 * Les valeurs par défaut sont des littéraux de l'AST (`'GT'`, `'close'`...),
 * typés par les unions du paquet partagé : aucun catalogue serveur n'est
 * impliqué, et l'ajout d'une valeur à une union casserait la compilation ici
 * plutôt que de passer inaperçu. Un opérande `indicator`, lui, dépend bien du
 * catalogue : son nom et ses paramètres sont donc exigés de l'appelant, qui
 * les tient de `/exchanges/meta`.
 * ============================================================================
 */

export function createPriceOperand(field: PriceField = 'close'): Operand {
  return { type: 'price', field };
}

export function createNumberOperand(value = 0): Operand {
  return { type: 'number', value };
}

/**
 * `operand` porte le nom de l'indicateur, ses paramètres et son éventuel
 * `subField` — tous issus du catalogue servi par le bot, jamais devinés ici.
 * L'appelant renseigne les paramètres explicitement (plutôt que de les laisser
 * se résoudre par défaut côté serveur) pour que la stratégie stockée dise
 * exactement ce qu'elle calcule, même si les défauts du bot changent ensuite.
 */
export function createIndicatorOperand(operand: IndicatorOperand): Operand {
  return { type: 'indicator', ...operand } as Operand;
}

/** Groupe logique vide : l'état de départ d'une branche, invalide tant qu'aucune condition n'y est ajoutée. */
export function createLogicalGroup(operator: LogicalOperator = 'AND'): LogicalGroup {
  return { type: 'logical', operator, conditions: [] };
}

export function createComparison(): ComparisonCondition {
  return {
    type: 'comparison',
    left: createPriceOperand(),
    operator: 'GT',
    right: createNumberOperand(),
  };
}

export function createTrend(): TrendCondition {
  return {
    type: 'trend',
    target: createPriceOperand(),
    direction: 'UP',
    period: 3,
  };
}

export function createCross(): CrossCondition {
  return {
    type: 'cross',
    left: createPriceOperand(),
    right: createNumberOperand(),
    direction: 'UP',
  };
}

/** `not` inverse un sous-arbre : il en reçoit donc un valide, jamais un trou. */
export function createNot(condition: RuleNode = createComparison()): NotCondition {
  return { type: 'not', condition };
}

export function createConstant(value = true): ConstantCondition {
  return { type: 'constant', value };
}

/** Types de nœud que cette version sait construire — sous-ensemble assumé de `RuleNode['type']`. */
export type CreatableNodeType = 'logical' | 'comparison' | 'trend' | 'cross' | 'not' | 'constant';

/** Aiguillage unique depuis le sélecteur de type de nœud de l'UI. */
export function createRuleNode(type: CreatableNodeType): RuleNode {
  switch (type) {
    case 'logical':
      return createLogicalGroup();
    case 'comparison':
      return createComparison();
    case 'trend':
      return createTrend();
    case 'cross':
      return createCross();
    case 'not':
      return createNot();
    case 'constant':
      return createConstant();
  }
}
