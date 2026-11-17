import {
  HL_ORDER_TYPE,
  parseTrailingStopCondition,
  TrailingStopConditionError,
  type HLFrontendOpenOrder,
  type HLTrailingRetracementState,
} from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * CE QU'EST UN TRAILING STOP NATIF À CET INSTANT, LU UNE SEULE FOIS
 *
 * Un trailing stop natif d'Hyperliquid (`orderType` `"Trailing Stop Market"`, 2026-09-21) n'a pas
 * d'état dans ses champs : il l'écrit en texte dans `triggerCondition`, lu ici par le lecteur strict
 * du paquet partagé (`parseTrailingStopCondition`). La liste, le détail et le chart lisent tous cet
 * état-ci, pour ne pas pouvoir diverger.
 *
 * Mesuré sur le compte de développement, les 16 et 17 novembre 2026
 * (`nest-trading-bot/docs/hyperliquid/live-check.md`) :
 *
 * - **en suivi** : `best <px>` donne le meilleur prix vu, et `triggerPx` le stop courant, hors de la
 *   grille des prix (1 811,5 × 0,9 = 1 630,35) ;
 * - **en attente d'activation** : `best waiting`, et `triggerPx` vaut `"0.0"` — un « Trigger 0.0 »
 *   affiché tel quel ferait croire à un stop à zéro ;
 * - `limitPx` n'est pas un prix que l'utilisateur a choisi (≈ déclencheur × 0,9, la borne d'un stop
 *   au marché, hypothèse non prouvée) : il ne s'affiche pas pour ce type.
 *
 * Un état qui ne se lit pas, ou qui se contredit (en suivi avec un stop à zéro, immédiat mais en
 * attente), devient `unreadable` avec le texte brut : on le montre, on ne le devine pas.
 * ============================================================================
 */

export type TrailingStopView =
  | {
      state: 'tracking';
      /** Le stop courant, tel que l'exchange l'écrit. */
      stopPx: string;
      /** Le meilleur prix vu depuis l'activation (le watermark). */
      best: string;
      retracement: string;
      /** Le prix qui a démarré le suivi, ou `null` s'il a commencé à la pose. */
      activation: { direction: 'above' | 'below'; px: string } | null;
    }
  | {
      state: 'waiting';
      activation: { direction: 'above' | 'below'; px: string };
      retracement: string;
    }
  | { state: 'unreadable'; raw: string; reason: string };

type TrailingOrderFields = Pick<
  HLFrontendOpenOrder,
  'orderType' | 'triggerCondition' | 'triggerPx'
>;

export function isTrailingStop(order: Pick<HLFrontendOpenOrder, 'orderType'>): boolean {
  return order.orderType === HL_ORDER_TYPE.trailingStopMarket;
}

/**
 * Le repli avec son unité : `10 %` ou `275 $` (une distance en prix, écrite nue par l'exchange).
 *
 * Le pourcentage s'arrondit à quatre décimales, la précision de l'action signée (`toFixed(4)`) :
 * l'exchange écrit `3.5000000000000004%` pour 3,5 % posé depuis l'interface officielle (mesuré le
 * 2026-11-17), un artefact de flottant qui coupait la ligne en deux à 360 px. Rien n'est perdu : au-delà
 * de quatre décimales, ce n'est plus une valeur qui a pu être signée. Le texte brut reste au détail.
 */
export function retracementLabel(retracement: HLTrailingRetracementState): string {
  if (retracement.kind === 'px') return `${retracement.px} $`;
  const rounded = Number(retracement.pct)
    .toFixed(4)
    .replace(/\.?0+$/, '');
  return `${rounded} %`;
}

const ZERO = /^0(?:\.0+)?$/;

/** L'état d'un trailing stop natif, ou `null` si l'ordre n'en est pas un. */
export function trailingStopView(order: TrailingOrderFields): TrailingStopView | null {
  if (!isTrailingStop(order)) return null;

  const raw = order.triggerCondition ?? '';
  let condition;
  try {
    condition = parseTrailingStopCondition(raw);
  } catch (error) {
    if (error instanceof TrailingStopConditionError) {
      return { state: 'unreadable', raw, reason: 'Unrecognised trailing stop state' };
    }
    throw error;
  }

  const retracement = retracementLabel(condition.retracement);
  const activation =
    condition.activation.kind === 'immediate'
      ? null
      : { direction: condition.activation.kind, px: condition.activation.px };

  if (condition.best === null) {
    // Un suivi immédiat a un meilleur prix dès la pose : « immediate » et « waiting » se contredisent.
    if (activation === null) {
      return { state: 'unreadable', raw, reason: 'Immediate tracking cannot be waiting' };
    }
    return { state: 'waiting', activation, retracement };
  }

  if (ZERO.test(order.triggerPx ?? '') || !order.triggerPx) {
    return { state: 'unreadable', raw, reason: `Tracking with a stop at ${order.triggerPx}` };
  }

  return {
    state: 'tracking',
    stopPx: order.triggerPx,
    best: condition.best,
    retracement,
    activation,
  };
}

/** `Above 2355` : le prix qui démarre le suivi, et de quel côté il doit être franchi. */
export function activationLabel(activation: { direction: 'above' | 'below'; px: string }): string {
  return `${activation.direction === 'above' ? 'Above' : 'Below'} ${activation.px}`;
}

/** La phrase d'une ligne de liste : courte, parce qu'elle tient à 360 px. */
export function trailingStopSummary(view: TrailingStopView): string {
  switch (view.state) {
    case 'tracking':
      return `Stop ${view.stopPx} · best ${view.best} · ${view.retracement}`;
    case 'waiting':
      return `Waiting ${view.activation.direction} ${view.activation.px} · then ${view.retracement}`;
    case 'unreadable':
      return `${view.reason}: "${view.raw}"`;
  }
}

/**
 * Ce que le chart dessine d'un trailing stop : **son niveau actuel seulement**. On ne connaît que
 * l'état courant (le niveau a suivi le prix depuis la pose), donc tirer un trait depuis l'heure de
 * pose raconterait un stop resté à ce niveau depuis le début — ce que faisait le chart jusqu'au
 * 2026-11-17, en même temps qu'il sautait un trailing en attente (`triggerPx` `"0.0"`).
 *
 * - en suivi : le stop courant, à la couleur d'un stop s'il est reduce-only ; sinon celle de son
 *   côté, comme un ordre qui peut ouvrir une position ;
 * - en attente : le prix d'activation, en couleur neutre — c'est là qu'il commencera à suivre.
 *
 * `null` pour un état illisible : il n'y a pas de prix sûr à dessiner.
 */
export interface TrailingChartMark {
  price: string;
  label: string;
  tone: 'stop' | 'buy' | 'sell' | 'waiting';
}

/**
 * Où poser l'étiquette d'un niveau dans le pane, quand l'échelle ne l'atteint pas.
 *
 * `priceToCoordinate` rend une ordonnée même hors du pane : un trailing en attente à 1250, sous une
 * échelle de 1700 à 2200, était dessiné hors du canvas, donc **jamais vu**, sans rien qui le dise
 * (mesuré le 2026-11-17). Hors du pane, l'étiquette se colle au bord franchi et porte une flèche ;
 * elle ne doit pas se lire comme un niveau à cette hauteur, d'où `pinned`.
 *
 * `margin` est la demi-hauteur de l'étiquette : collée au bord, elle reste entière.
 */
export function pinToPane(
  y: number,
  paneHeight: number,
  margin: number,
): { y: number; pinned: 'above' | 'below' | null } {
  if (y < margin) return { y: margin, pinned: y < 0 ? 'above' : null };
  if (y > paneHeight - margin) {
    return { y: paneHeight - margin, pinned: y > paneHeight ? 'below' : null };
  }
  return { y, pinned: null };
}

export function trailingChartMark(
  view: TrailingStopView,
  order: Pick<HLFrontendOpenOrder, 'side' | 'reduceOnly'>,
): TrailingChartMark | null {
  switch (view.state) {
    case 'tracking':
      return {
        price: view.stopPx,
        label: `TS ${view.stopPx}`,
        tone: order.reduceOnly ? 'stop' : order.side === 'B' ? 'buy' : 'sell',
      };
    case 'waiting':
      return {
        price: view.activation.px,
        label: `TS ${view.activation.direction === 'above' ? '≥' : '≤'} ${view.activation.px}`,
        tone: 'waiting',
      };
    case 'unreadable':
      return null;
  }
}
