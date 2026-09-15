import type { IndicatorParameter } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🔢 INDICATOR PARAMETERS
 * Ramène la valeur d'un paramètre d'indicateur au type que le catalogue
 * déclare pour lui.
 *
 * Pourquoi ce fichier existe : un `ion-input`, même `type="number"`, rend une
 * **chaîne**. Le formulaire d'opérande écrivait cette chaîne telle quelle dans
 * l'opérande, et personne ne la rattrapait — `validateIndicatorOperand` (paquet
 * partagé) ne regarde que `name` et `subField`, jamais les paramètres, si bien
 * que `POST /exchanges/strategies/validate` répondait `valid: true`. Le bot
 * calculait ensuite l'EMA avec `2 / (period + 1)` où `period` vaut `"20"` :
 * `2 / "201"`, soit un lissage dix fois trop long. La stratégie affichait
 * `EMA(20)`, le serveur la disait valide, et le signal était faux.
 * Collatéralement, `computeOperandLookback` rendait `"200"` au lieu de `20`, et
 * `expressionId` traçait deux courbes pour un même indicateur.
 *
 * Deux règles, et la seconde compte autant que la première :
 *
 * 1. **Ce que le catalogue déclare fait foi** — `type: 'number'` impose un
 *    nombre fini, un `select` impose l'une des valeurs de sa liste, avec le
 *    type littéral qu'elle porte.
 * 2. **On ne répare que le certain.** Une chaîne numérique est une évidence,
 *    on la convertit. Tout le reste — valeur illisible, paramètre que ce build
 *    ne connaît pas — est **conservé verbatim** : effacer un paramètre ferait
 *    silencieusement retomber le bot sur son propre défaut, et un paramètre
 *    inconnu vient probablement d'un bot plus récent (même raisonnement que la
 *    réécriture verbatim de strategy-tree.ops.ts).
 * ============================================================================
 */

/** Valeur d'un paramètre telle qu'elle est écrite dans un opérande `indicator`. */
export type IndicatorParameterValue = number | string;

/**
 * Valeur à écrire pour `raw`, ou `null` pour **ne rien écrire** — champ vidé en
 * cours de frappe, ou saisie que rien ne permet d'interpréter.
 *
 * `null` plutôt qu'une valeur de repli : une saisie illisible ne doit pas
 * remplacer la valeur précédente, qui est au moins cohérente. Et surtout pas
 * par `NaN`, que `JSON.stringify` écrit `null` — le paramètre disparaîtrait du
 * document, et le bot appliquerait son défaut sans que rien ne le dise.
 */
export function coerceIndicatorParameter(
  declared: IndicatorParameter | undefined,
  raw: unknown,
): IndicatorParameterValue | null {
  if (raw === null || raw === undefined || raw === '') return null;

  // Paramètre absent du catalogue : ce build n'a pas d'avis, il transmet.
  if (!declared) return raw as IndicatorParameterValue;

  switch (declared.type) {
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(value) ? value : null;
    }

    case 'select': {
      // Le type littéral vient de l'option déclarée, jamais de l'événement :
      // un `ion-select` peut rendre `'1'` là où le catalogue dit `1`.
      const option = declared.options.find((candidate) => String(candidate.value) === String(raw));
      return option ? option.value : (raw as IndicatorParameterValue);
    }

    default:
      return String(raw);
  }
}

/**
 * Tous les paramètres d'un opérande `indicator`, ramenés au type déclaré.
 *
 * Sert à la relecture : rouvrir un opérande écrit par un build atteint par le
 * défaut suffit à le réparer, sans attendre que l'utilisateur retouche le
 * champ. Une valeur qu'on ne sait pas convertir est conservée telle quelle —
 * la signaler est le travail de la validation, pas celui d'une conversion.
 */
export function coerceIndicatorParameters(
  parameters: Readonly<Record<string, unknown>>,
  declared: readonly IndicatorParameter[] | undefined,
): Record<string, IndicatorParameterValue> {
  const byName = new Map((declared ?? []).map((parameter) => [parameter.name, parameter]));
  const coerced: Record<string, IndicatorParameterValue> = {};

  for (const [name, value] of Object.entries(parameters)) {
    coerced[name] =
      coerceIndicatorParameter(byName.get(name), value) ?? (value as IndicatorParameterValue);
  }

  return coerced;
}
