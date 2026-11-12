import type { HLL2BookLevel, HLL2BookResponse, HLOrderDetails } from '@syldel/hl-shared-types';
import { roundPrice } from '@utils/hl-rounding.utils';

/**
 * ============================================================================
 * Un ordre au marché, tel que ce mobile le passe : **un seul IOC**, à un prix plafond calculé
 * depuis le mid ± le glissement maximal. C'est la forme du SDK Python officiel
 * (`exchange.py`, `market_open` / `market_close` : `_slippage_price` sur `all_mids`, puis
 * `{"limit": {"tif": "Ioc"}}`), lue en brut le 2026-11-12.
 *
 * Pas `POST /orders/instant` du gateway : sur un IOC sans contrepartie il relance jusqu'à six fois,
 * 7,5 s d'écart, à un nouveau prix chaque fois. Un comportement de bot, pas d'un bouton : on
 * appuie une fois, un ordre part. Le prix plafond est celui que l'écran de confirmation a affiché,
 * jamais recalculé en route.
 * ============================================================================
 */

/**
 * Le glissement maximal par défaut, en %. Décidé avec l'utilisateur le 2026-11-12 : 0,2 % (celui
 * du gateway) laisse un BTC agité sans exécution, 5 % (celui du SDK) accepte un prix qu'on ne
 * voudrait pas sur un marché liquide.
 */
export const DEFAULT_MAX_SLIPPAGE_PCT = 1;

/**
 * Bornes du réglage. 10 % est la tolérance qu'Hyperliquid applique à ses propres TP/SL au marché
 * (`take-profit-and-stop-loss-orders-tp-sl.md`) : au-delà, ce n'est plus un ordre au marché
 * protégé, c'est un ordre sans plafond. 0,05 % : en dessous, le plafond tombe dans l'arrondi à
 * cinq chiffres significatifs d'un BTC.
 */
export const MIN_MAX_SLIPPAGE_PCT = 0.05;
export const MAX_MAX_SLIPPAGE_PCT = 10;

export function isValidMaxSlippage(pct: number): boolean {
  return Number.isFinite(pct) && pct >= MIN_MAX_SLIPPAGE_PCT && pct <= MAX_MAX_SLIPPAGE_PCT;
}

/** Le haut du carnet, ou la raison pour laquelle il n'y a pas de mid. */
export type BookTop =
  | { status: 'ok'; bid: number; ask: number; mid: number }
  | { status: 'unavailable'; reason: string };

/**
 * Le mid du carnet : `(meilleur bid + meilleur ask) / 2`, la définition de `allMids`. Pris dans
 * `l2Book` plutôt que dans `allMids` pour que le mid, le spread et le parcours du carnet viennent
 * de la MÊME photographie : trois lectures, trois instants, et le prix plafond ne serait plus
 * cohérent avec l'estimation affichée à côté.
 *
 * Un côté vide n'a pas de mid : on le dit, on ne prend pas l'autre côté seul.
 */
export function readBookTop(book: HLL2BookResponse | null | undefined): BookTop {
  const levels = book?.levels;
  if (!Array.isArray(levels) || levels.length !== 2) {
    return { status: 'unavailable', reason: 'The order book answer has no bid and ask sides.' };
  }
  const bid = Number(levels[0][0]?.px);
  const ask = Number(levels[1][0]?.px);
  if (!levels[0].length || !levels[1].length) {
    return {
      status: 'unavailable',
      reason: `The order book is one-sided (${levels[0].length} bid level(s), ${levels[1].length} ask level(s)): there is no mid price.`,
    };
  }
  if (!(bid > 0) || !(ask > 0)) {
    return { status: 'unavailable', reason: 'The best bid or ask is not a price.' };
  }
  if (bid >= ask) {
    return {
      status: 'unavailable',
      reason: `The order book is crossed (bid ${bid} ≥ ask ${ask}): its mid cannot be trusted.`,
    };
  }
  return { status: 'ok', bid, ask, mid: (bid + ask) / 2 };
}

/**
 * Le prix plafond d'un achat (plancher d'une vente) : mid × (1 ± glissement), arrondi sur la grille
 * de prix des perps (cinq chiffres significatifs, `6 - szDecimals` décimales). L'arrondi peut
 * déplacer le plafond d'une fraction de tick : c'est la valeur ARRONDIE qui s'affiche et qui part,
 * donc ce qui est vu est ce qui est accepté.
 */
export function worstPrice(
  mid: number,
  isBuy: boolean,
  slippagePct: number,
  szDecimals: number,
): string {
  const factor = isBuy ? 1 + slippagePct / 100 : 1 - slippagePct / 100;
  // `roundPrice` peut rendre des zéros de queue (« 2426.6000 » : `toFixed(20)` de 2426,6 vaut
  // 2426,5999…, mesuré dans le spec). La valeur est juste, l'écriture non : on la normalise, un prix
  // perp ayant au plus 6 décimales, `String` ne passe jamais en notation exponentielle ici.
  return String(Number(roundPrice(mid * factor, szDecimals, false)));
}

/** Ce que le carnet visible dit d'un ordre de cette taille, sans dépasser le prix plafond. */
export interface BookWalk {
  requestedSz: number;
  /** La taille que les niveaux visibles remplissent sans dépasser le plafond. */
  fillableSz: number;
  /** Le prix moyen de cette part, `null` si rien n'est remplissable. */
  avgPx: number | null;
  /**
   * Les niveaux visibles se sont épuisés avant la taille ET avant le plafond : `l2Book` n'en rend
   * que 20 par côté (`info-endpoint.md`). Au-delà, le carnet n'est pas connu — ni vide, ni plein.
   */
  depthExhausted: boolean;
}

const SIZE_EPSILON = 1e-12;

/**
 * Parcourt le côté du carnet qu'un ordre au marché consomme — les asks pour un achat, les bids pour
 * une vente — jusqu'à la taille demandée ou jusqu'au plafond.
 */
export function walkBook(
  book: HLL2BookResponse,
  isBuy: boolean,
  sz: number,
  worstPx: number,
): BookWalk {
  const side: HLL2BookLevel[] = isBuy ? book.levels[1] : book.levels[0];
  let remaining = sz;
  let cost = 0;
  let stoppedByBound = false;

  for (const level of side) {
    if (remaining <= SIZE_EPSILON) break;
    const px = Number(level.px);
    const levelSz = Number(level.sz);
    if (!(px > 0) || !(levelSz > 0)) continue;
    if (isBuy ? px > worstPx : px < worstPx) {
      stoppedByBound = true;
      break;
    }
    const take = Math.min(remaining, levelSz);
    cost += take * px;
    remaining -= take;
  }

  const fillableSz = sz - Math.max(remaining, 0);
  return {
    requestedSz: sz,
    fillableSz: remaining <= SIZE_EPSILON ? sz : fillableSz,
    avgPx: fillableSz > SIZE_EPSILON ? cost / fillableSz : null,
    depthExhausted: remaining > SIZE_EPSILON && !stoppedByBound,
  };
}

/** L'ordre qui part : un IOC au prix plafond. `reduceOnly` pour une fermeture. */
export function buildMarketOrder(input: {
  assetName: string;
  isBuy: boolean;
  sz: string;
  worstPx: string;
  reduceOnly: boolean;
}): HLOrderDetails {
  return {
    assetName: input.assetName,
    isBuy: input.isBuy,
    limitPx: input.worstPx,
    sz: input.sz,
    reduceOnly: input.reduceOnly,
    orderType: { limit: { tif: 'Ioc' } },
  };
}
