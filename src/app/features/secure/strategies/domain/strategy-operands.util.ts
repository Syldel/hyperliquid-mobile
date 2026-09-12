import type { Operand, RuleNode, StrategyRules } from '@syldel/trading-shared-types';
import { walkRuleTree } from '@syldel/trading-shared-types';
import { DEFAULT_STRATEGY_BRANCHES, type StrategyBranch } from '../models/strategy-document.model';
import {
  operandScale,
  resolveNeutral,
  type OperandScale,
  type ScaleCatalogue,
} from './operand-scale.util';
import { isOperandLocallySound } from './strategy-issues.util';
import { getAtPath } from './strategy-tree.ops';

/**
 * ============================================================================
 * 📈 STRATEGY OPERANDS
 * Les opérandes qu'une stratégie compare, prêts à être tracés sur le chart via
 * `AnalysisRequest.expressions[]`.
 *
 * Ce sont les opérandes **de premier niveau** de chaque condition — `left` et
 * `right` d'une comparaison ou d'un croisement, `target` d'une tendance — et
 * non leurs feuilles. C'est délibéré et c'est tout l'intérêt : une règle
 * compare `EMA(20) + ATR(14)` à `close`, donc la courbe à regarder est la somme
 * entière, pas l'EMA et l'ATR séparées. `walkRuleTree` sait faire les deux ;
 * son `onOperand` descend jusqu'aux feuilles, on passe donc par `onNode`.
 *
 * **L'`id` est calculé ici et envoyé au serveur.** `ExpressionRequest.id` est
 * facultatif — sans lui, la clé de réponse vient de `buildOperandKey`, qui
 * complète les paramètres manquants depuis le registre **compilé**
 * (`INDICATOR_DEFAULTS`). Un `ema` sans période explicite se lirait alors
 * `ema_9` ici et `ema_12` côté bot dès que ses défauts changent, et la série
 * serait introuvable dans la réponse. Fournir l'id supprime le problème à la
 * racine : la clé est celle qu'on a choisie, quoi que fasse le catalogue.
 * ============================================================================
 */

/** Un opérande traçable, tel qu'il sera demandé puis retrouvé dans la réponse. */
export interface StrategyExpression {
  /** Clé de requête *et* de réponse. Dérivée du contenu, jamais d'un catalogue. */
  id: string;
  operand: Operand;
  /** Libellés des branches où il apparaît — d'où vient cette courbe. */
  branches: string[];
  /**
   * Où la tracer (operand-scale.util.ts). Une constante emprunte l'échelle de
   * ce à quoi la condition la compare : un seuil n'a pas d'unité propre.
   *
   * Si le même opérande revient dans deux conditions d'échelles différentes, la
   * première rencontrée décide — un cas si tordu qu'arbitrer plus finement
   * coûterait plus de complexité que d'exactitude.
   */
  scale: OperandScale;
  /**
   * `false` si ce build est certain que le bot refusera cet opérande.
   *
   * `POST /analysis` valide `expressions[]` en bloc : un seul opérande
   * malformé fait rejeter la requête entière, indicateurs compris. On ne
   * l'envoie donc pas — mais on continue de le lister, marqué, plutôt que de
   * le faire disparaître sans un mot.
   */
  sound: boolean;
}

/**
 * Retire `offset` à tous les niveaux.
 *
 * Un offset ne change pas la série calculée, seulement la position lue dedans
 * (même raison que son exclusion de `buildOperandKey`). Deux conditions lisant
 * `close` et `close[t-1]` regardent donc la même courbe, et la dédupliquer
 * évite de tracer deux fois la même chose sous deux noms.
 */
export function stripOperandOffsets(operand: Operand): Operand {
  const node = operand as unknown as Record<string, unknown>;
  const { offset: _offset, ...rest } = node;

  switch (operand.type) {
    case 'arith':
      return {
        ...rest,
        left: stripOperandOffsets(operand.left),
        right: stripOperandOffsets(operand.right),
      } as unknown as Operand;

    case 'transform':
      return { ...rest, source: stripOperandOffsets(operand.source) } as unknown as Operand;

    case 'fn':
      return { ...rest, args: operand.args.map(stripOperandOffsets) } as unknown as Operand;

    default:
      return rest as unknown as Operand;
  }
}

/**
 * Identifiant stable d'un opérande, dérivé de son contenu.
 *
 * Les clés sont triées avant hachage : le même opérande construit par
 * l'éditeur ou relu depuis un JSON n'a pas forcément le même ordre de
 * propriétés, et deux ids différents pour une même courbe la feraient tracer
 * deux fois. Deux hachages distincts sont combinés — le risque de collision
 * d'un djb2 seul est faible, mais une collision tracerait silencieusement la
 * mauvaise série, ce qui est exactement le contraire du but recherché ici.
 */
export function expressionId(operand: Operand): string {
  const serialized = stableStringify(stripOperandOffsets(operand));

  let djb2 = 5381;
  let sdbm = 0;

  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    djb2 = (djb2 * 33) ^ code;
    sdbm = (code + (sdbm << 6) + (sdbm << 16) - sdbm) | 0;
  }

  return `expr_${toHex(djb2)}${toHex(sdbm)}`;
}

/**
 * Tous les opérandes traçables d'une stratégie, dans l'ordre de première
 * rencontre, chacun apparaissant une seule fois.
 *
 * Les constantes (`number`) sont gardées : sur `zscore(...) > 2`, la ligne
 * plate à 2 est précisément le repère qui rend la règle lisible.
 */
export function collectStrategyOperands(
  rules: StrategyRules | undefined | null,
  catalogue: ScaleCatalogue,
  branches: readonly StrategyBranch[] = DEFAULT_STRATEGY_BRANCHES,
): StrategyExpression[] {
  if (!rules) return [];

  const found = new Map<string, StrategyExpression>();

  for (const branch of branches) {
    const node = getAtPath(rules, `rules.${branch.id}`);
    if (!node || typeof node !== 'object') continue;

    walkRuleTree(node as RuleNode, {
      onNode: (visited) => {
        for (const { operand, sibling } of topLevelOperands(visited)) {
          add(found, operand, sibling, branch.label, catalogue);
        }
      },
    });
  }

  return [...found.values()];
}

/**
 * Les opérandes portés directement par un nœud, chacun avec celui auquel la
 * condition le confronte — rien pour un groupe logique ou un `not`.
 */
function topLevelOperands(node: RuleNode): { operand: Operand; sibling?: Operand }[] {
  switch (node.type) {
    case 'comparison':
    case 'cross':
      return [
        { operand: node.left, sibling: node.right },
        { operand: node.right, sibling: node.left },
      ];
    case 'trend':
      return [{ operand: node.target }];
    default:
      return [];
  }
}

function add(
  found: Map<string, StrategyExpression>,
  operand: Operand,
  sibling: Operand | undefined,
  branchLabel: string,
  catalogue: ScaleCatalogue,
): void {
  const stripped = stripOperandOffsets(operand);
  const id = expressionId(stripped);
  const existing = found.get(id);

  if (existing) {
    if (!existing.branches.includes(branchLabel)) existing.branches.push(branchLabel);
    return;
  }

  const scale = resolveNeutral(
    operandScale(stripped, catalogue),
    sibling ? operandScale(sibling, catalogue) : { kind: 'neutral' },
  );

  found.set(id, {
    id,
    operand: stripped,
    branches: [branchLabel],
    scale,
    sound: isOperandLocallySound(stripped),
  });
}

/** JSON à clés triées, récursivement — voir `expressionId`. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${entries.join(',')}}`;
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
