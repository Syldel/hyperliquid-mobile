/**
 * ============================================================================
 * Les garde-fous du formulaire : des ordres valides pour Hyperliquid, mais probablement pas voulus.
 *
 * Tous sont des AVERTISSEMENTS, jamais des blocages (décidé le 2026-11-12, avec l'utilisateur) : le
 * serveur reste juge de ce qui est valide, et un cas inhabituel doit rester possible. Ce qui est
 * certainement faux (un limite du mauvais côté, un ordre sous 10 $) est bloqué ailleurs, dans
 * `order-limit.util.ts` et le formulaire.
 *
 * Chaque fonction rend la phrase à afficher, ou `null`.
 * ============================================================================
 */

/** La position ouverte sur la paire, telle que le formulaire la lit. */
export interface OpenPosition {
  isBuy: boolean;
  /** Taille absolue. */
  sz: number;
}

/**
 * G1 — Un ordre LIMITE reduce-only qui croise le marché : une vente de fermeture sous le marché, ou
 * un rachat au-dessus. `isPriceInvalid` laisse passer les reduce-only, à raison (fermer sous le
 * marché est un choix possible), mais un tel ordre s'exécute AUSSITÔT, en taker, jusqu'à son prix :
 * un ordre au marché déguisé, sans la confirmation ni le verdict du vrai. Choisir « Close Limit »,
 * c'est d'ordinaire vouloir un ordre qui attend.
 *
 * Égal au marché n'est pas dit : `currentPrice` est un mid, le croisement réel dépend du carnet.
 */
export function crossingCloseLimitWarning(input: {
  orderKind: string;
  reduceOnly: boolean;
  isBuy: boolean;
  limitPx: string;
  currentPrice: number | null;
}): string | null {
  if (input.orderKind !== 'limit' || !input.reduceOnly) return null;
  const limit = Number(input.limitPx);
  const market = input.currentPrice;
  if (!(limit > 0) || !market || !(market > 0)) return null;
  const crosses = input.isBuy ? limit > market : limit < market;
  if (!crosses) return null;
  return input.isBuy
    ? `This limit is above the market: it fills now, as a taker, up to ${input.limitPx}. Use Close › Market for that, or set a limit below the market to wait.`
    : `This limit is below the market: it fills now, as a taker, down to ${input.limitPx}. Use Close › Market for that, or set a limit above the market to wait.`;
}

export type PositionEffect =
  | { kind: 'adds'; text: string }
  | { kind: 'reduces'; text: string }
  | { kind: 'closes'; text: string }
  | { kind: 'flips'; text: string };

function sideWord(isBuy: boolean, usesBuySell: boolean): string {
  if (usesBuySell) return isBuy ? 'buy' : 'sell';
  return isBuy ? 'long' : 'short';
}

/** Une taille affichée sans les queues flottantes (`0.00015 - 0.0001` = `0.00004999…`). */
function sizeText(sz: number): string {
  return String(Number(sz.toFixed(8)));
}

/**
 * G2 — Ce qu'un ordre NON reduce-only fait à la position ouverte, s'il est de sens opposé : il la
 * réduit, la ferme, ou la RETOURNE — ferme le long et ouvre un short de l'excédent. Le retournement
 * est l'ordre « Sell » tapé pour fermer, avec une taille de trop : Hyperliquid l'exécute sans rien
 * dire. `adds` et les ordres reduce-only rendent `null` : rien de surprenant.
 *
 * C'est l'effet sur la position D'AUJOURD'HUI : un ordre limite qui attend s'appliquera à celle
 * qui existera quand il s'exécutera.
 */
export function positionEffect(input: {
  position: OpenPosition | null;
  isBuy: boolean;
  sz: number;
  reduceOnly: boolean;
  usesBuySell?: boolean;
}): PositionEffect | null {
  const { position, isBuy, sz, reduceOnly } = input;
  if (reduceOnly || !position || !(position.sz > 0) || !(sz > 0)) return null;
  if (position.isBuy === isBuy) return null;
  const held = sideWord(position.isBuy, !!input.usesBuySell);
  const opened = sideWord(isBuy, !!input.usesBuySell);
  const posSz = sizeText(position.sz);
  // Une différence sous la grille de taille est une égalité (`1e-12`, comme la feuille de fermeture).
  if (Math.abs(sz - position.sz) <= 1e-12) {
    return { kind: 'closes', text: `Closes your ${held} ${posSz}.` };
  }
  if (sz < position.sz) {
    return {
      kind: 'reduces',
      text: `Reduces your ${held} ${posSz} to ${sizeText(position.sz - sz)}.`,
    };
  }
  return {
    kind: 'flips',
    text: `Closes your ${held} ${posSz} AND opens a ${opened} ${sizeText(sz - position.sz)}. To close only, use the position's Close buttons.`,
  };
}

/**
 * La taille qui OUVRE une exposition : toute la taille sans position ou dans son sens ; contre elle,
 * seulement l'excédent qui la retourne. Un reduce-only n'ouvre rien.
 */
export function openingSize(input: {
  position: OpenPosition | null;
  isBuy: boolean;
  sz: number;
  reduceOnly: boolean;
}): number {
  const { position, isBuy, sz, reduceOnly } = input;
  if (reduceOnly || !(sz > 0)) return 0;
  if (!position || position.isBuy === isBuy) return sz;
  return Math.max(0, sz - position.sz);
}

/**
 * G3 — La marge que l'ordre demande dépasse le capital disponible. Hyperliquid le refusera
 * probablement, mais APRÈS l'envoi ; le dire avant évite un aller-retour.
 *
 * Marge ≈ part ouvrante × prix / levier, comparée au capital disponible PLUS la marge que libère la
 * position fermée au passage (`freedSz` × prix / levier) : un retournement rachète d'abord le
 * short, dont la marge revient. Sans elle, un retournement d'un short de 23 $ de marge était annoncé
 * « 0.00 $ available » (mesuré le 2026-11-12, compte unifié tout engagé). ⚠️ Une approximation, d'où l'avertissement et non le
 * blocage : les frais n'y sont pas, le capital affiché est `total − used` du gateway et non
 * l'`availableToTrade` d'Hyperliquid, et la façon dont Hyperliquid réserve la marge d'un ordre
 * limite qui attend n'a pas été mesurée. Le verdict du serveur fait autorité.
 */
export function marginShortfallWarning(input: {
  openingSz: number;
  /** La taille de position opposée que l'ordre ferme avant d'ouvrir ; 0 sinon. */
  freedSz?: number;
  price: number | null;
  leverage: number | null;
  available: number | null;
}): string | null {
  const { openingSz, price, leverage, available } = input;
  if (!(openingSz > 0) || !price || !(price > 0) || !leverage || !(leverage > 0)) return null;
  if (available === null || !(available >= 0)) return null;
  const margin = (openingSz * price) / leverage;
  const freed = ((input.freedSz ?? 0) * price) / leverage;
  const usable = available + freed;
  if (margin <= usable) return null;
  const freedText = freed > 0 ? ` (with ${freed.toFixed(2)} $ freed by the close)` : '';
  return `Needs ≈ ${margin.toFixed(2)} $ of margin at ${leverage}x, ${usable.toFixed(2)} $ available${freedText}: Hyperliquid will likely refuse it.`;
}

/**
 * Au-delà, un glissement maximal est jugé large : 3 %. ⚠️ Un CHOIX, pas une mesure — le SDK
 * officiel prend 5 % par défaut pour `market_open`, et Hyperliquid borne lui-même un déclencheur au
 * marché à 10 %. 3 % laisse passer les réglages courants (0,5 à 2 %) sans bruit.
 */
export const WIDE_SLIPPAGE_PCT = 3;

/** G4 — Un glissement maximal large : l'ordre accepte d'être exécuté loin du mid. */
export function wideSlippageWarning(pct: number): string | null {
  if (!Number.isFinite(pct) || pct <= WIDE_SLIPPAGE_PCT) return null;
  return `The order accepts a price up to ${pct} % away from the mid: on a thin book, it can fill that far.`;
}
