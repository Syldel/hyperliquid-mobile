import type {
  ArithOperator,
  ComparisonOperator,
  CrossDirection,
  RuleBuilderGrammar,
  TrendDirection,
} from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🔤 STRATEGY FORMAT
 * Rendu compact et lisible d'un nœud ou d'un opérande, pour les chips et les
 * résumés de l'arbre (« EMA(9) crosses above SMA(20) »).
 *
 * À ne pas confondre avec `RuleBuilderGrammar` (servie par `/exchanges/meta`),
 * qui porte les **libellés longs des sélecteurs** — « Greater Than or Equal
 * (>=) », destinés à un menu déroulant. Ici, il s'agit de rendre une condition
 * déjà construite sur une seule ligne : « ≥ » et « Greater Than or Equal (>=) »
 * ne sont pas deux copies du même libellé, ce sont deux usages différents, et
 * un chip de trois mots ne peut pas afficher le second.
 *
 * Les tables ci-dessous sont des `Record` exhaustifs sur les unions de l'AST :
 * l'ajout d'un opérateur au paquet partagé casse la compilation ici plutôt que
 * de passer silencieusement à travers. Rien de tout cela ne dépend d'un
 * catalogue serveur.
 *
 * Les paramètres d'un opérande `indicator` sont rendus **tels qu'ils sont
 * stockés**, jamais complétés par les valeurs par défaut du registre compilé :
 * afficher « EMA(9) » pour un opérande sans période alors que le bot en
 * exécute 12 serait un mensonge d'interface.
 * ============================================================================
 */

const COMPARISON_SYMBOLS: Record<ComparisonOperator, string> = {
  GT: '>',
  GTE: '≥',
  LT: '<',
  LTE: '≤',
  EQ: '=',
};

const ARITH_SYMBOLS: Record<ArithOperator, string> = {
  ADD: '+',
  SUB: '−',
  MUL: '×',
  DIV: '÷',
};

const CROSS_LABELS: Record<CrossDirection, string> = {
  UP: 'crosses above',
  DOWN: 'crosses below',
  ANY: 'crosses',
};

const TREND_ARROWS: Record<TrendDirection, string> = {
  UP: '↗',
  DOWN: '↘',
};

/** Rendu des nœuds/opérandes que ce build ne sait pas interpréter. */
export const UNSUPPORTED_LABEL = 'Unsupported';

/** Clés d'un opérande `indicator` qui ne sont pas des paramètres de calcul. */
const NON_PARAMETER_KEYS = new Set(['type', 'name', 'subField', 'offset']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function formatOffset(offset: unknown): string {
  return typeof offset === 'number' && offset > 0 ? `[t-${offset}]` : '';
}

function formatIndicator(operand: Record<string, unknown>): string {
  const name = String(operand['name'] ?? '?').toUpperCase();
  const params = Object.entries(operand)
    .filter(([key]) => !NON_PARAMETER_KEYS.has(key))
    .map(([, value]) => String(value));

  const base = params.length > 0 ? `${name}(${params.join(', ')})` : name;
  const subField = operand['subField'];
  const line = typeof subField === 'string' ? `${base}.${subField}` : base;

  return `${line}${formatOffset(operand['offset'])}`;
}

/** Rendu d'un opérande, récursif sur `arith` / `transform` / `fn`. */
export function formatOperand(operand: unknown): string {
  const node = asRecord(operand);
  if (!node) return UNSUPPORTED_LABEL;

  switch (node['type']) {
    case 'price':
      return `${String(node['field'])}${formatOffset(node['offset'])}`;

    case 'number':
      return String(node['value']);

    case 'indicator':
      return formatIndicator(node);

    case 'arith': {
      const symbol = ARITH_SYMBOLS[node['operator'] as ArithOperator] ?? '?';
      return `(${formatOperand(node['left'])} ${symbol} ${formatOperand(node['right'])})`;
    }

    case 'transform': {
      const period = node['period'];
      const args = [formatOperand(node['source'])];
      if (typeof period === 'number') args.push(String(period));
      return `${String(node['kind'])}(${args.join(', ')})${formatOffset(node['offset'])}`;
    }

    case 'fn': {
      const args = Array.isArray(node['args']) ? node['args'] : [];
      return `${String(node['kind'])}(${args.map(formatOperand).join(', ')})`;
    }

    default:
      return UNSUPPORTED_LABEL;
  }
}

export interface FormatRuleNodeOptions {
  /**
   * Profondeur de groupes logiques rendue en clair. Au-delà, un groupe est
   * résumé (« 3 conditions ») — c'est le pendant textuel de l'arbre hybride :
   * inline sur deux niveaux, puis un chip qui ouvre un écran dédié.
   */
  maxDepth?: number;
  /**
   * Grammaire servie par `/exchanges/meta`, quand l'appelant l'a sous la main.
   *
   * Utilisée pour la seule énumération que ce fichier ne sait pas rendre par
   * une notation : le sens d'un croisement, qui n'a pas de glyphe standard et
   * doit donc s'écrire en toutes lettres. Sans elle, le repli local ci-dessus
   * s'applique — le formatage reste une fonction pure, appelable sans réseau
   * ni contexte Angular.
   *
   * Les autres tables (`>`, `≥`, `×`, `↗`) restent locales à dessein : ce sont
   * des notations mathématiques, pas des libellés, et elles ne peuvent donc
   * pas contredire un libellé serveur qui changerait.
   */
  grammar?: Pick<RuleBuilderGrammar, 'crossDirections'>;
}

/** `maxDepth` résolu une fois pour toutes ; `grammar` reste facultative. */
type ResolvedFormatOptions = FormatRuleNodeOptions & { maxDepth: number };

function formatNode(node: unknown, depth: number, options: ResolvedFormatOptions): string {
  const current = asRecord(node);
  if (!current) return UNSUPPORTED_LABEL;

  const { maxDepth } = options;

  switch (current['type']) {
    case 'logical': {
      const conditions = Array.isArray(current['conditions']) ? current['conditions'] : [];
      if (conditions.length === 0) return 'No condition';

      if (depth >= maxDepth) {
        return conditions.length === 1 ? '1 condition' : `${conditions.length} conditions`;
      }

      const parts = conditions.map((child) => formatNode(child, depth + 1, options));
      const joined = parts.join(` ${String(current['operator'])} `);
      return depth === 0 || parts.length === 1 ? joined : `(${joined})`;
    }

    case 'comparison': {
      const symbol = COMPARISON_SYMBOLS[current['operator'] as ComparisonOperator] ?? '?';
      return `${formatOperand(current['left'])} ${symbol} ${formatOperand(current['right'])}`;
    }

    case 'cross': {
      const direction = current['direction'] as CrossDirection;
      // Le libellé serveur est repris tel quel, casse comprise : le reformater
      // reviendrait à réintroduire une formulation locale par la petite porte.
      const label =
        options.grammar?.crossDirections.find((option) => option.value === direction)?.label ??
        CROSS_LABELS[direction] ??
        'crosses';
      return `${formatOperand(current['left'])} ${label} ${formatOperand(current['right'])}`;
    }

    case 'trend': {
      const arrow = TREND_ARROWS[current['direction'] as TrendDirection] ?? '?';
      const mode = current['mode'];
      // `STRICT` est le défaut : ne l'afficher que lorsqu'il a été choisi explicitement.
      const suffix = typeof mode === 'string' && mode !== 'STRICT' ? ` (${mode})` : '';
      return `${formatOperand(current['target'])} ${arrow} over ${String(current['period'])}${suffix}`;
    }

    case 'not':
      return `NOT (${formatNode(current['condition'], depth, options)})`;

    case 'constant':
      return current['value'] === true ? 'Always true' : 'Always false';

    default:
      return UNSUPPORTED_LABEL;
  }
}

/** Rendu d'un nœud sur une ligne, groupes profonds résumés. */
export function formatRuleNode(node: unknown, options: FormatRuleNodeOptions = {}): string {
  return formatNode(node, 0, { ...options, maxDepth: options.maxDepth ?? 2 });
}
