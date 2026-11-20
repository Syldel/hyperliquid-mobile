import {
  HL_ORDER_TYPE,
  parseTrailingStopCondition,
  TrailingStopConditionError,
  type HLFrontendOpenOrder,
  type HLOid,
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

/**
 * Où lire l'état **courant** d'un trailing stop ouvert, quand on part d'`orderStatus`.
 *
 * `orderStatus` rend l'état de la **pose**, figé : son meilleur prix est resté celui de la pose pendant
 * 19 minutes et quatre nouveaux plus bas, et l'ordre a été rempli 0,255 % sous le stop qu'il affichait
 * — ce stop n'était pas appliqué (mesuré le 2026-11-17 sur BTC, `nest-trading-bot/docs/hyperliquid/
 * live-check.md`, S6). `frontendOpenOrders` suit le watermark. Le détail affichait le stop figé.
 *
 * - `not-needed` : pas un trailing stop, ou plus ouvert — il n'a plus d'état courant à lire ;
 * - `live` : l'ordre d'`orderStatus`, avec l'état et les prix de `frontendOpenOrders` ;
 * - `missing` : ouvert selon `orderStatus` mais absent de la liste (déclenché ou annulé entre les deux
 *   lectures, ou liste illisible). On le dit, on ne retombe pas sur l'état de la pose.
 */
export type LiveTrailingState<T> =
  | { kind: 'not-needed' }
  | { kind: 'live'; order: T }
  | { kind: 'missing'; reason: string };

type LiveFields = Pick<HLFrontendOpenOrder, 'oid' | 'triggerCondition' | 'triggerPx' | 'limitPx'>;

export function liveTrailingState<T extends LiveFields & Pick<HLFrontendOpenOrder, 'orderType'>>(
  order: T,
  status: string | null,
  listed: readonly LiveFields[] | null,
): LiveTrailingState<T> {
  if (!isTrailingStop(order) || status !== 'open') return { kind: 'not-needed' };
  if (listed === null) {
    return { kind: 'missing', reason: 'The open orders list could not be read' };
  }
  const current = listed.find((o) => o.oid === order.oid);
  if (!current) {
    return {
      kind: 'missing',
      reason: 'Not in the open orders list: it may have just triggered or been cancelled',
    };
  }
  return {
    kind: 'live',
    order: {
      ...order,
      triggerCondition: current.triggerCondition,
      triggerPx: current.triggerPx,
      limitPx: current.limitPx,
    },
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

/**
 * D'où un trailing stop est parti : l'état de sa **pose**, lu dans `historicalOrders`, que le chart charge
 * déjà — aucune lecture en plus.
 *
 * L'historique garde un enregistrement par statut, et celui du statut `open` fige l'état au moment de la
 * pose : 65 165,9 pour le trailing de S6, resté tel quel pendant que le stop courant descendait
 * (`nest-trading-bot/docs/hyperliquid/live-check.md`). C'est donc une valeur **exacte** du point de départ
 * — pas l'escalier entre les deux, que l'API ne garde nulle part (relevé le 2026-11-17).
 *
 * - posé en suivi : le stop de la pose ;
 * - posé en attente : le prix d'activation, là où le suivi devait commencer ;
 * - `null` si la pose n'est pas dans l'historique (il ne garde que les ordres récents) ou si son état ne se
 *   lit pas : il n'y a pas de départ sûr à dessiner. Un autre enregistrement (`canceled`, `triggered`) ne
 *   la remplace jamais : il porte l'état de la fin.
 */
export interface TrailingStart {
  /** Heure de la pose, en ms. */
  time: number;
  price: string;
  waiting: boolean;
  /**
   * Le meilleur prix vu à la pose (le watermark de départ de `trailing-stop-staircase.util.ts`), ou
   * `null` pour une pose en attente : elle n'en avait pas encore.
   */
  best: string | null;
}

export function trailingStart(
  oid: HLOid,
  history: readonly {
    order: TrailingOrderFields & Pick<HLFrontendOpenOrder, 'oid'>;
    status: string;
    statusTimestamp: number;
  }[],
): TrailingStart | null {
  let pose: (typeof history)[number] | undefined;
  for (const h of history) {
    if (h.order.oid !== oid || h.status !== 'open') continue;
    if (!pose || h.statusTimestamp < pose.statusTimestamp) pose = h;
  }
  if (!pose) return null;

  const view = trailingStopView(pose.order);
  if (!view) return null;
  switch (view.state) {
    case 'tracking':
      return { time: pose.statusTimestamp, price: view.stopPx, waiting: false, best: view.best };
    case 'waiting':
      return { time: pose.statusTimestamp, price: view.activation.px, waiting: true, best: null };
    case 'unreadable':
      return null;
  }
}
