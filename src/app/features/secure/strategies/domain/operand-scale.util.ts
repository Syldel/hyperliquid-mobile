import type { Operand } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 📏 OPERAND SCALE
 * Sur quelle échelle se lit un opérande : celle des prix — donc par-dessus les
 * bougies — ou une échelle à lui, dans un panneau séparé.
 *
 * La question n'a rien d'esthétique. `EMA(9)` et `(EMA(20) + ATR(14))` sont des
 * niveaux de prix : les tracer ailleurs que sur les bougies revient à cacher la
 * seule chose qu'on veut voir, leur position par rapport au cours. À l'inverse,
 * `zscore(close, 200)` tient entre -3 et +3 ; posé sur des bougies à 77 000 $,
 * ce serait une ligne plate collée au bas du graphe.
 *
 * Rien n'est deviné : `IndicatorMetadata.overlay` et
 * `TransformMetadata.outputScale` viennent de `/exchanges/meta`, comme le reste
 * du catalogue. Ce qui est *inconnu de ce build* obtient son propre panneau
 * plutôt que l'échelle des prix — se tromper vers le panneau coûte un peu de
 * hauteur, se tromper vers les prix écrase les bougies.
 *
 * Les combinaisons relèvent en revanche d'une convention assumée, écrite ici :
 * ajouter une volatilité à un prix donne un prix (`EMA(20) + ATR(14)` est une
 * bande), tandis que diviser un prix par un prix donne un rapport sans unité.
 * ============================================================================
 */

/**
 * `price` : se trace sur l'échelle des bougies.
 * `group` : a besoin d'une échelle à lui ; deux opérandes du même groupe la partagent.
 * `neutral` : une constante, qui n'impose rien et suit ce à quoi on la compare.
 */
export type OperandScale =
  | { kind: 'price' }
  | { kind: 'group'; group: string }
  | { kind: 'neutral' };

/** Ce que le catalogue servi par le bot sait dire d'un nom d'indicateur ou de transformation. */
export interface ScaleCatalogue {
  /** `IndicatorMetadata.overlay` — `undefined` si ce build ne connaît pas l'indicateur. */
  indicatorOverlay(name: string): boolean | undefined;
  /** `TransformMetadata.outputScale` — `undefined` si ce build ne connaît pas la transformation. */
  transformOutputScale(kind: string): string | undefined;
}

const PRICE: OperandScale = { kind: 'price' };
const NEUTRAL: OperandScale = { kind: 'neutral' };

export function operandScale(operand: Operand, catalogue: ScaleCatalogue): OperandScale {
  switch (operand.type) {
    case 'price':
      return PRICE;

    case 'number':
      return NEUTRAL;

    case 'indicator': {
      const overlay = catalogue.indicatorOverlay(operand.name);
      return overlay === true ? PRICE : { kind: 'group', group: `indicator:${operand.name}` };
    }

    case 'transform': {
      const output = catalogue.transformOutputScale(operand.kind);
      if (output === undefined) return { kind: 'group', group: `transform:${operand.kind}` };
      // `sameAsSource` ne transforme pas l'unité — une pente de prix reste en prix.
      if (output === 'sameAsSource') return operandScale(operand.source, catalogue);
      return { kind: 'group', group: `scale:${output}` };
    }

    case 'arith':
      return arithScale(
        operand.operator,
        operandScale(operand.left, catalogue),
        operandScale(operand.right, catalogue),
      );

    case 'fn':
      // `min`/`max` renvoient l'un de leurs arguments : même échelle qu'eux.
      return operand.args
        .map((argument) => operandScale(argument, catalogue))
        .reduce(combine, NEUTRAL);
  }
}

/** `true` si l'opérande se trace par-dessus les bougies. Une constante suit son voisin, pas ce test. */
export function isPriceScale(scale: OperandScale): boolean {
  return scale.kind === 'price';
}

/** Clé de regroupement : les opérandes qui la partagent peuvent partager une échelle. */
export function scaleGroupOf(scale: OperandScale): string {
  return scale.kind === 'price' ? 'price' : scale.kind === 'group' ? scale.group : 'neutral';
}

/**
 * Échelle d'une constante, empruntée à ce qu'on lui compare.
 *
 * Un seuil n'a pas d'unité propre : `2` face à un z-score appartient au
 * panneau du z-score, `100000` face à `close` appartient aux bougies. Le
 * comparer à autre chose qu'à son voisin de condition n'aurait aucun sens.
 */
export function resolveNeutral(scale: OperandScale, sibling: OperandScale): OperandScale {
  return scale.kind === 'neutral' ? sibling : scale;
}

function arithScale(operator: string, left: OperandScale, right: OperandScale): OperandScale {
  // Un prix divisé par un prix est un rapport sans unité — le seul cas où deux
  // opérandes de l'échelle des prix n'en produisent pas un.
  if (operator === 'DIV' && left.kind === 'price' && right.kind === 'price') {
    return { kind: 'group', group: 'scale:ratio' };
  }

  // Ailleurs, un prix domine : lui ajouter, retrancher ou appliquer un facteur
  // laisse un niveau de prix.
  if (left.kind === 'price' || right.kind === 'price') return PRICE;

  return combine(left, right);
}

function combine(left: OperandScale, right: OperandScale): OperandScale {
  if (left.kind === 'neutral') return right;
  if (right.kind === 'neutral') return left;
  if (scaleGroupOf(left) === scaleGroupOf(right)) return left;

  // Deux échelles étrangères : le résultat n'appartient à aucune des deux, donc
  // à un groupe qui lui est propre — stable, pour que la même expression
  // retombe toujours au même endroit.
  return {
    kind: 'group',
    group: `mixed:${[scaleGroupOf(left), scaleGroupOf(right)].sort().join('+')}`,
  };
}
