import {
  parseTrailingStopCondition,
  type HLFrontendOpenOrder,
  type HLTrailingRetracementState,
} from '@syldel/hl-shared-types';
import { trailingStart, trailingStopView } from './trailing-stop-view.util';

/**
 * ============================================================================
 * L'ESCALIER D'UN TRAILING STOP, RECONSTITUÉ BOUGIE PAR BOUGIE
 *
 * L'API ne garde pas le chemin d'un trailing stop : seulement l'état de sa pose (`historicalOrders`,
 * statut `open`) et l'état présent (`frontendOpenOrders`, ou l'enregistrement `triggered`). Entre les
 * deux, on le reconstitue depuis les bougies que le chart a déjà — aucune lecture en plus.
 *
 * La règle de l'exchange, lue en brut dans la FAQ officielle le 2026-11-20
 * (`support/faq/trailing-stops.md`) : le watermark est le plus haut (trailing de vente) ou le plus bas
 * (trailing d'achat) du **prix mark** depuis l'activation, le stop vaut watermark × (1 ∓ taux) ou
 * watermark ∓ distance, et il ne bouge **que** sur un nouveau watermark — jamais en arrière. Il
 * n'attend pas la clôture d'une bougie.
 *
 * Ce qui est donc exact et ce qui ne l'est pas :
 *
 * - les deux bouts sont **exacts** : le départ est l'état de la pose, la fin l'état présent ;
 * - entre les deux, on ne sait pas **quand** dans la bougie le watermark a bougé : la bougie se dessine
 *   en **bande**, du stop le plus prudent à son ouverture au stop le plus avancé à sa clôture. Une seule
 *   valeur par bougie affirmerait une précision que les données n'ont pas ;
 * - les bougies sont des prix d'**échange** (`candleSnapshot`), pas du mark — aucune bougie de mark dans
 *   la doc de l'endpoint info. Mesuré : sur S6 (BTC, 2026-11-17), une mèche d'échange a dépassé le mark
 *   de 21,8 $ (0,034 %) ; sur `xyz:BRENTOIL` (2026-11-20), 90,400 contre 90,398 (0,002 %). Le
 *   watermark reconstitué est donc **borné par le watermark présent** (`clipped` dit de combien), et
 *   l'écart en milieu de course n'est pas corrigé — c'est l'approximation de ce dessin ;
 * - la bougie de la pose contient des prix **d'avant** la pose : son extrême n'est qu'une borne haute.
 *   D'où les deux bornes `lo` / `hi` du watermark, qui se rejoignent dès qu'une bougie suivante le
 *   dépasse (mesuré : la bougie de 23:05Z de BRENTOIL montait à 90,126 avant une pose à 90,075).
 *
 * Seul un trailing posé **en suivi** a un départ connu. Un trailing posé en attente d'activation a
 * commencé à suivre à un instant que rien ne donne : il n'a pas d'escalier.
 * ============================================================================
 */

export interface StaircaseCandle {
  /** Ouverture de la bougie, en ms. */
  t: number;
  h: number;
  l: number;
}

export interface StaircaseInput {
  /** `A` : un trailing de vente, qui suit les plus hauts. `B` : un trailing d'achat, les plus bas. */
  side: 'A' | 'B';
  retracement: HLTrailingRetracementState;
  /** La pose : son heure et son watermark, exacts (`historicalOrders`, statut `open`). */
  start: { time: number; best: number };
  /** L'état présent (ou le déclenchement) : son heure et son watermark, exacts. */
  end: { time: number; best: number };
  candles: readonly StaircaseCandle[];
  intervalMs: number;
  /**
   * Les décimales de prix du marché (`6 − szDecimals` sur un perp). L'exchange arrondit le stop d'un
   * trailing au plus proche sur cette grille **seule**, sans la limite de cinq chiffres significatifs des
   * prix d'ordre : 64 971 × 1,003 = 65 165,913 écrit 65165.9, 64 919 × 1,003 = 65 113,757 écrit 65113.8
   * (BTC, S6, 2026-11-17 — l'arrondi au plus proche, pas la troncature) ; 1 811,5 × 0,9 = 1630.35 sur
   * ETH. Sans cet arrondi, la fin de l'escalier tombait à côté du stop écrit par l'exchange.
   *
   * `null` : pas d'arrondi. C'est le cas du chart, qui n'a pas la méta du marché et ne la lit pas pour
   * ça (20 de poids) : un pas de prix y fait moins d'un pixel — 0,1 $ sur un BTC à 65 000 dans un pane de
   * 400 px couvrant 2 %, environ 0,03 px.
   */
  pxDecimals: number | null;
}

/**
 * Une marche : pendant la bougie qui ouvre à `t`, le stop était entre `from` (le plus prudent à
 * l'ouverture) et `to` (le plus avancé à la clôture). Égaux, la bougie n'a rien changé de sûr.
 */
export interface StaircaseStep {
  t: number;
  from: number;
  to: number;
}

export type TrailingStaircase =
  | {
      kind: 'drawn';
      steps: StaircaseStep[];
      /** De combien les mèches d'échange ont dépassé le watermark présent, coupé à sa valeur. */
      clipped: number;
      /** De combien la dernière marche a dû sauter pour rejoindre le watermark présent. */
      missed: number;
    }
  | { kind: 'uncovered'; reason: string };

/**
 * L'arrondi de l'exchange sur la grille : au plus proche, une égalité **vers le haut**. Mesuré sur
 * 610736354584 (2026-11-19) : 90,075 × 0,95 = 85,57125, écrit 85.5713. `toFixed` rendait 85.5712, le
 * produit flottant valant 85,571249999… : on efface ce bruit (15 chiffres) avant d'arrondir. Une seule
 * égalité mesurée, sur un stop de vente ; celle d'un stop d'achat est supposée suivre la même règle.
 */
export function roundToTick(px: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(Number((px * scale).toPrecision(15))) / scale;
}

/** Le stop d'un watermark, avant l'arrondi de l'exchange (voir `pxDecimals`). */
export function stopAt(
  side: 'A' | 'B',
  retracement: HLTrailingRetracementState,
  best: number,
): number {
  const sign = side === 'A' ? -1 : 1;
  return retracement.kind === 'pct'
    ? best * (1 + (sign * Number(retracement.pct)) / 100)
    : best + sign * Number(retracement.px);
}

export function trailingStaircase(input: StaircaseInput): TrailingStaircase {
  const { side, start, end, intervalMs } = input;
  // Tout se compare dans le sens d'un trailing de vente : un trailing d'achat se lit en négatif.
  const k = side === 'A' ? 1 : -1;
  const startBest = k * start.best;
  const endBest = k * end.best;
  if (end.time < start.time || endBest < startBest) {
    return {
      kind: 'uncovered',
      reason: `The present state (${end.best} at ${end.time}) does not follow the placement (${start.best} at ${start.time}).`,
    };
  }

  const candles = [...input.candles].sort((a, b) => a.t - b.t);
  const contains = (c: StaircaseCandle, time: number) => c.t <= time && time < c.t + intervalMs;
  if (!candles.some((c) => contains(c, start.time))) {
    return { kind: 'uncovered', reason: 'No candle holds the placement: it is outside the chart.' };
  }
  if (!candles.some((c) => contains(c, end.time))) {
    return { kind: 'uncovered', reason: 'No candle holds the present state.' };
  }

  const stop = (signedBest: number) => {
    const px = stopAt(side, input.retracement, k * signedBest);
    return input.pxDecimals === null ? px : roundToTick(px, input.pxDecimals);
  };
  const steps: StaircaseStep[] = [];
  let lo = startBest;
  let hi = startBest;
  let clipped = 0;
  let missed = 0;

  for (const c of candles) {
    if (c.t + intervalMs <= start.time || c.t > end.time) continue;
    const extreme = side === 'A' ? c.h : -c.l;
    clipped = Math.max(clipped, extreme - endBest);
    const seen = Math.min(extreme, endBest);
    const open = lo;
    if (contains(c, end.time)) {
      missed = Math.max(0, endBest - Math.max(hi, seen));
      lo = hi = endBest;
    } else if (contains(c, start.time)) {
      // Une partie de la bougie précède la pose : son extrême n'est pas sûr.
      hi = Math.max(hi, seen);
    } else {
      lo = Math.max(lo, seen);
      hi = Math.max(hi, seen);
    }
    steps.push({ t: c.t, from: stop(open), to: stop(hi) });
  }

  return { kind: 'drawn', steps, clipped, missed };
}

/**
 * L'escalier d'un trailing stop **ouvert**, tel que le chart le dessine : sa pose dans l'historique
 * (`trailingStart`), son état présent dans la liste, et les bougies déjà chargées.
 *
 * L'état présent se pose sur la **dernière bougie chargée** : la liste et les bougies sont lues ensemble,
 * mais les bougies restent en cache un quart de leur intervalle (`hyperliquid-candle.service.ts`), et
 * cette dernière bougie peut donc finir avant `now`. Au-delà d'**un** intervalle de retard, la série
 * n'est plus celle du présent (une fenêtre passée, un cache inattendu) : pas d'escalier, plutôt qu'un
 * état présent attribué à une bougie d'une autre heure.
 */
export function trailingStaircaseOf(
  order: Pick<HLFrontendOpenOrder, 'oid' | 'side' | 'orderType' | 'triggerCondition' | 'triggerPx'>,
  history: Parameters<typeof trailingStart>[1],
  candles: readonly StaircaseCandle[],
  intervalMs: number,
  now: number,
): TrailingStaircase {
  const view = trailingStopView(order);
  if (view?.state !== 'tracking') {
    return { kind: 'uncovered', reason: 'Not a tracking trailing stop.' };
  }
  const start = trailingStart(order.oid, history);
  if (start === null) {
    return { kind: 'uncovered', reason: 'The placement is not in the order history.' };
  }
  if (start.best === null) {
    // Posé en attente : il a commencé à suivre à un instant que rien ne donne.
    return { kind: 'uncovered', reason: 'Placed waiting for activation: its start is not known.' };
  }
  const last = candles.at(-1);
  if (last === undefined || now >= last.t + 2 * intervalMs) {
    return { kind: 'uncovered', reason: 'The candles do not reach the present.' };
  }
  // Déjà lu sans erreur par `trailingStopView`, qui l'a dit en suivi.
  const { retracement } = parseTrailingStopCondition(order.triggerCondition ?? '');
  return trailingStaircase({
    side: order.side,
    retracement,
    start: { time: start.time, best: Number(start.best) },
    end: { time: Math.min(now, last.t + intervalMs - 1), best: Number(view.best) },
    candles,
    intervalMs,
    pxDecimals: null,
  });
}
