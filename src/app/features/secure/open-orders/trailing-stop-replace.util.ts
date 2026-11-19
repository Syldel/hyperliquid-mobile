import {
  parseTrailingStopCondition,
  TrailingStopConditionError,
  type HLFrontendOpenOrder,
  type HLOid,
} from '@syldel/hl-shared-types';
import { exchangeRefusal } from '@utils/hl-error.utils';
import type { TrailingEntryPlan, TrailingUnit } from './trailing-stop-entry.util';
import { formatStop } from './trailing-stop-entry.util';
import type { TrailingStopView } from './trailing-stop-view.util';

/**
 * ============================================================================
 * REMPLACER UN TRAILING STOP : POSER LE NOUVEAU, PUIS ANNULER L'ANCIEN (étape 4, `docs/roadmap.md`)
 *
 * Hyperliquid ne modifie pas un trailing stop : ni la doc ni l'interface officielle n'en proposent la
 * modification. Remplacer, ce sont **deux actions**, sans atomicité, et dans cet ordre :
 *
 * 1. **poser le nouveau d'abord** : deux trailings coexistent sur la même position, chacun avec son
 *    watermark (mesuré le 2026-11-17, S1 / S2). Annuler d'abord laisserait la position nue entre les deux ;
 * 2. **annuler l'ancien seulement si la pose a réussi**. Après une pose à l'issue inconnue, l'ancien reste :
 *    deux trailings valent mieux que zéro, et une position fermée par l'un retire l'autre
 *    (`reduceOnlyCanceled`, mesuré le 2026-11-16, T4).
 *
 * Annuler se renvoie sans risque : un second `cancel` du même oid échoue sans rien changer. Poser, non :
 * l'action n'a pas de `cloid`.
 *
 * Et ce que l'écran doit dire avant : **le suivi repart du prix marqué du moment**. Le nouveau stop part de
 * là, et il est souvent plus éloigné que l'ancien, qui avait suivi le prix (`stopChange`).
 * ============================================================================
 */

/** Ce que le formulaire reprend d'un trailing à remplacer. */
export interface TrailingPrefill {
  sz: string;
  unit: TrailingUnit;
  value: string;
  /** Vide : le suivi commencera à la pose. */
  activation: string;
}

/**
 * Les valeurs de l'ancien trailing, pour pré-remplir le remplaçant : taille, repli avec son unité, et
 * l'activation **seulement s'il attend encore**. Un trailing qui suit déjà a franchi son activation : la
 * reprendre la mettrait du mauvais côté du marqué, et la saisie serait refusée.
 *
 * Le pourcentage s'arrondit à quatre décimales, la précision signée : l'exchange relit `3.5000000000000004%`
 * pour 3,5 % (2026-11-17). `null` si l'état ne se lit pas : rien ne se devine.
 */
export function trailingPrefill(
  order: Pick<HLFrontendOpenOrder, 'sz' | 'triggerCondition'>,
): TrailingPrefill | null {
  let condition;
  try {
    condition = parseTrailingStopCondition(order.triggerCondition ?? '');
  } catch (error) {
    if (error instanceof TrailingStopConditionError) return null;
    throw error;
  }
  const retracement = condition.retracement;
  const waiting = condition.best === null && condition.activation.kind !== 'immediate';
  return {
    sz: order.sz,
    unit: retracement.kind,
    value:
      retracement.kind === 'pct'
        ? Number(retracement.pct)
            .toFixed(4)
            .replace(/\.?0+$/, '')
        : retracement.px,
    activation: waiting && condition.activation.kind !== 'immediate' ? condition.activation.px : '',
  };
}

/**
 * Ce que le remplacement fait au stop : l'ancien **courant** (lu dans `frontendOpenOrders`, qui fait foi)
 * contre le nouveau **au départ** de son suivi.
 *
 * - `compare` : `looser` quand le nouveau part plus loin du prix — plus bas pour une vente, plus haut pour un
 *   achat. Un avertissement, pas un refus : élargir peut être voulu ;
 * - `old-waiting` : l'ancien attend son activation, il ne protège encore rien ;
 * - `old-unknown` : l'ancien ne se lit pas, ou n'est plus dans la liste.
 */
export type StopChange =
  | { kind: 'compare'; from: string; to: string; looser: boolean; text: string }
  | { kind: 'old-waiting'; text: string }
  | { kind: 'old-unknown'; text: string };

/**
 * Un stop-loss ordinaire remplacé par un trailing (2026-11-19) : son seuil est fixe, et c'est lui qu'on
 * compare au départ du trailing.
 */
export interface FixedStop {
  state: 'fixed';
  stopPx: string;
}

export function stopChange(
  old: TrailingStopView | FixedStop | null,
  plan: Pick<TrailingEntryPlan, 'isBuy' | 'stopAtStart' | 'activation'>,
): StopChange {
  if (old === null || old.state === 'unreadable') {
    return {
      kind: 'old-unknown',
      text: 'The trailing stop to replace cannot be read: its current stop is unknown.',
    };
  }
  if (old.state === 'waiting') {
    return {
      kind: 'old-waiting',
      text: `The old one is still waiting for ${old.activation.direction} ${old.activation.px}: it protects nothing yet.`,
    };
  }
  const to = formatStop(plan.stopAtStart);
  const from = Number(old.stopPx);
  // Fermer un long (vente) : un stop plus bas est plus lâche. Fermer un short (achat) : plus haut.
  const looser = plan.isBuy ? plan.stopAtStart > from : plan.stopAtStart < from;
  const start = plan.activation ? 'once it activates' : 'at the start';
  const fixed = old.state === 'fixed';
  return {
    kind: 'compare',
    from: old.stopPx,
    to,
    looser,
    text:
      `Your stop moves from ${old.stopPx} (${fixed ? 'the stop loss' : 'now'}) to ${to} ${start}: ` +
      `${looser ? 'looser, further from the price' : 'tighter, closer to the price'}. ` +
      (fixed ? 'From there it follows the price.' : 'Tracking starts over from the current mark.'),
  };
}

/**
 * Ce que le formulaire Trail rend à sa fermeture, en remplacement : `replaced` seulement quand l'annulation de
 * l'ancien a répondu `success`. Toute autre fermeture rend `null`.
 */
export interface TrailingReplaced {
  kind: 'replaced';
  newOid: number;
  oldOid: HLOid;
}

/**
 * Ce que la page de détail de l'**ancien** trailing fait à la fermeture du formulaire.
 *
 * - `list` après un remplacement réussi : la réponse `success` de l'annulation fait foi, et la liste lit
 *   `frontendOpenOrders`. Relire l'ancien oid montrait un faux état : mesuré le 2026-11-19 à 17:35,
 *   `orderStatus` répondait encore `open`, avec l'état de la pose, juste après l'annulation réussie, alors
 *   que `frontendOpenOrders` ne le listait déjà plus. La page affichait « Status open » et « Not in the open
 *   orders list » ; `canceled` moins de deux minutes plus tard ;
 * - `reread` après toute autre écriture (deux trailings, ancien disparu, issue inconnue) : la page relit, et
 *   dit ce qu'elle voit ;
 * - `stay` : rien n'a été envoyé.
 */
export function afterTrailingForm(
  role: string | undefined,
  data: TrailingReplaced | null | undefined,
): 'list' | 'reread' | 'stay' {
  if (role !== 'confirm') return 'stay';
  return data?.kind === 'replaced' ? 'list' : 'reread';
}

/**
 * La réponse à l'annulation de l'ancien.
 *
 * - `cancelled` : `statuses: ["success"]` (mesuré, S3 et S7) ;
 * - `gone` : l'ordre n'était plus là — déclenché, rempli ou déjà annulé. ⚠️ Le texte reconnu, « Order was
 *   never placed, already canceled, or filled. », vient de la doc et du SDK, **pas d'une mesure**
 *   (`nest-trading-bot/docs`) : un autre texte tombe dans `refused`, qui se dit tel quel ;
 * - `refused` : un refus, d'ensemble ou pour cet ordre, avec son texte ;
 * - `unknown` : une réponse sans statut lisible.
 */
export type CancelReply =
  | { kind: 'cancelled' }
  | { kind: 'gone'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown' };

// La phrase entière, pas un mot : « filled » seul se lit dans d'autres refus.
const GONE = /never placed, already canceled, or filled/i;

export function readCancelReply(reply: unknown): CancelReply {
  const refusal = exchangeRefusal(reply);
  if (refusal) return { kind: 'refused', message: refusal };
  const statuses = (reply as { response?: { data?: { statuses?: unknown } } } | null)?.response
    ?.data?.statuses;
  const status = Array.isArray(statuses) ? statuses[0] : undefined;
  if (status === 'success') return { kind: 'cancelled' };
  const error =
    typeof status === 'object' && status !== null ? (status as { error?: unknown }).error : null;
  if (typeof error === 'string' && error) {
    return GONE.test(error)
      ? { kind: 'gone', message: error }
      : { kind: 'refused', message: error };
  }
  return { kind: 'unknown' };
}
