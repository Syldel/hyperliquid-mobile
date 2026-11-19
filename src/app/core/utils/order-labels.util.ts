import { isPerpMarket } from './market-kind.util';

/**
 * ============================================================================
 * LES ÉTIQUETTES D'UN ORDRE : UNE SEULE ÉCRITURE POUR TOUTE L'APP
 *
 * Relevé le 2026-11-17 : le même côté s'écrivait de quatre façons — `LONG` dans les positions,
 * `Long` dans Open Orders, `LONG` dans le détail (par un `text-transform` CSS), `Buy` dans
 * l'historique **même sur un perp**, `BUY` dans les fills — et le TIF tel que l'exchange l'écrit
 * (`Alo`), quand le formulaire disait déjà `ALO – Post only`.
 *
 * La règle retenue :
 *
 * - **les codes en capitales** (côté, sens d'un remplissage, TIF), les noms et les phrases en casse
 *   ordinaire (type d'ordre, `carried in`, `delisted`). Le statut garde l'écriture de l'API
 *   (`open`, `reduceOnlyCanceled`), par décision ;
 * - **le côté suit le genre du marché** : LONG / SHORT sur un perp, BUY / SELL sur un spot ;
 * - **un ordre reduce-only se dit par ce qu'il ferme** : un achat reduce-only sur un perp ferme un
 *   short. L'afficher `LONG` (un trailing stop ETH du 2026-11-17) faisait croire à une ouverture.
 * ============================================================================
 */

/**
 * Un badge de côté : le mot, l'action, et la couleur.
 *
 * Depuis le 2026-11-18 l'action ne s'écrit plus : `OPEN SHORT` était coupé à droite dans Trade History
 * sur un téléphone, et `CLOSE SHORT` encombrait Open Orders. Un glyphe plein la porte — ▲ ouvre un long, ▼ ouvre un short, ■ ferme
 * (`app-side-badge`). La **couleur suit le mot**, pas le sens de l'ordre : `■ SHORT` (un achat qui
 * ferme un short) est rouge comme le short qu'il ferme ; l'ancien `CLOSE SHORT` était vert, couleur
 * de l'achat, et se lisait comme une ouverture longue.
 */
export interface SideBadge {
  text: string;
  /** `null` : pas d'action à dire (une position, un spot, un sens que l'on ne classe pas). */
  action: 'open' | 'close' | null;
  tone: 'success' | 'danger';
}

/**
 * Le glyphe d'un badge de côté. ▲ ouvre un LONG — un achat —, ▼ ouvre un SHORT — une vente —, ■ ferme.
 * La convention ▲ achat / ▼ vente est celle des marqueurs de TradingView et des exécutions sur le chart
 * de la watchlist (2026-11-19, au lieu de ▶ pour toute ouverture).
 *
 * ■ ne dit pas de direction : fermer un short est un achat, mais le badge parle de la position. Un
 * badge qui ouvre sans dire LONG ni SHORT n'a pas de glyphe : une direction ne se devine pas.
 */
export type SideBadgeGlyph = 'buy' | 'sell' | 'close';

export function sideBadgeGlyph(badge: SideBadge): SideBadgeGlyph | null {
  if (badge.action === 'close') return 'close';
  if (badge.action !== 'open') return null;
  if (badge.text === 'LONG') return 'buy';
  if (badge.text === 'SHORT') return 'sell';
  return null;
}

const toneOf = (text: string, isBuy: boolean): SideBadge['tone'] =>
  text === 'LONG' ? 'success' : text === 'SHORT' ? 'danger' : isBuy ? 'success' : 'danger';

/**
 * Le badge d'un **ordre** : ▲ LONG / ▼ SHORT pour un perp qui ouvre, ■ SHORT / ■ LONG pour un
 * reduce-only (il se dit par ce qu'il ferme : un achat reduce-only ferme un short), BUY / SELL sans
 * glyphe sur un spot.
 */
export function orderSideBadge(coin: string, isBuy: boolean, reduceOnly = false): SideBadge {
  if (!isPerpMarket(coin)) {
    const text = isBuy ? 'BUY' : 'SELL';
    return { text, action: null, tone: toneOf(text, isBuy) };
  }
  if (reduceOnly) {
    const text = isBuy ? 'SHORT' : 'LONG';
    return { text, action: 'close', tone: toneOf(text, isBuy) };
  }
  const text = isBuy ? 'LONG' : 'SHORT';
  return { text, action: 'open', tone: toneOf(text, isBuy) };
}

/** Le badge d'une **position** : son côté seul, elle est ouverte par définition. */
export function positionSideBadge(coin: string, isLong: boolean): SideBadge {
  return { ...orderSideBadge(coin, isLong), action: null };
}

const FILL_DIR = /^(Open|Close) (Long|Short)$/;

/**
 * Le badge d'un **remplissage**, lu dans le `dir` de l'exchange. `Open Long` → ▲ LONG,
 * `Close Short` → ■ SHORT. Tout autre sens (`Buy`, `Long > Short`, une liquidation) s'écrit tel
 * quel en capitales, sans glyphe : un sens que l'on ne classe pas ne se devine pas. Un `dir` vide
 * retombe sur BUY / SELL plutôt que sur une pastille vide.
 */
export function fillSideBadge(fill: { dir?: string | null; side: 'A' | 'B' }): SideBadge {
  const isBuy = fill.side === 'B';
  const dir = fill.dir?.trim() ?? '';
  const match = FILL_DIR.exec(dir);
  if (match) {
    const text = match[2].toUpperCase();
    return { text, action: match[1] === 'Open' ? 'open' : 'close', tone: toneOf(text, isBuy) };
  }
  const text = dir ? dir.toUpperCase() : isBuy ? 'BUY' : 'SELL';
  return { text, action: null, tone: toneOf(text, isBuy) };
}

/**
 * Les trois TIF qu'un ordre peut porter à l'envoi, écrits par l'API `Gtc`, `Alo`, `Ioc`. Ce sont des
 * initiales : elles s'affichent en capitales, avec leur sens dans le détail et le formulaire. Les
 * listes n'affichent que le code (`tifLabel`).
 *
 * Tout autre TIF — `FrontendMarket`, que l'exchange renvoie pour un « Market » passé depuis son
 * interface — s'affiche **tel que l'API l'écrit**, casse comprise : l'utilisateur est un trader
 * averti, qui doit pouvoir rapprocher l'écran de la réponse brute (décidé le 2026-11-19 ; avant, tout
 * passait en capitales, `FRONTENDMARKET`).
 */
const KNOWN_TIFS: Record<string, { code: string; meaning: string }> = {
  Gtc: { code: 'GTC', meaning: 'Good till cancelled' },
  Alo: { code: 'ALO', meaning: 'Post only' },
  Ioc: { code: 'IOC', meaning: 'Immediate or cancel' },
};

/** `Alo` → `ALO` ; un TIF hors des trois, tel quel : `FrontendMarket`. */
export function tifLabel(tif: string): string {
  return KNOWN_TIFS[tif]?.code ?? tif;
}

/** `ALO – Post only`. Un TIF hors des trois s'affiche par son seul code, sans sens deviné. */
export function tifDescription(tif: string): string {
  const known = KNOWN_TIFS[tif];
  return known ? `${known.code} – ${known.meaning}` : tif;
}
