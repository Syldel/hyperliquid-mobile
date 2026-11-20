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
 * - **le côté est celui de l'API**, reduce-only compris (voir `SideBadge`, 2026-11-20).
 * ============================================================================
 */

/**
 * Un badge de côté : le mot et sa couleur, rien d'autre.
 *
 * **Le badge dit le côté que l'API écrit** (`side`, `B` / `A`), décidé le 2026-11-20 : B → LONG vert,
 * A → SHORT rouge sur un perp, BUY / SELL sur un spot. Un stop qui ferme un long est une vente : il
 * s'affiche **SHORT**, et c'est le tag « Reduce only » qui dit qu'il ferme. Ce qu'on a essayé avant, et
 * pourquoi on en est revenu :
 *
 * - `CLOSE LONG` / `CLOSE SHORT` (2026-11-17) : coupé à 360 px dans Trade History, encombrant dans Open
 *   Orders ;
 * - un glyphe pour l'action, ▲ / ▼ ouvre, ■ ferme, et le mot de la **position** fermée (2026-11-18 et
 *   2026-11-19) : un stop de long s'affichait LONG, l'inverse de son côté réel. L'utilisateur veut le vrai
 *   sens de l'ordre, au plus près de l'API, sans glyphe ni `CLOSE`.
 */
export interface SideBadge {
  text: string;
  tone: 'success' | 'danger';
}

const sideOf = (coin: string, isBuy: boolean): SideBadge => {
  const perp = isPerpMarket(coin);
  return {
    text: isBuy ? (perp ? 'LONG' : 'BUY') : perp ? 'SHORT' : 'SELL',
    tone: isBuy ? 'success' : 'danger',
  };
};

/**
 * Le badge d'un **ordre** : son côté, reduce-only ou non. LONG / SHORT sur un perp (dex principal ou
 * HIP-3), BUY / SELL sur un spot.
 */
export function orderSideBadge(coin: string, isBuy: boolean): SideBadge {
  return sideOf(coin, isBuy);
}

/** Le badge d'une **position** : son côté. */
export function positionSideBadge(coin: string, isLong: boolean): SideBadge {
  return sideOf(coin, isLong);
}

const FILL_DIR = /^(?:Open|Close) (?:Long|Short)$/;

/**
 * Le badge d'un **remplissage** : le côté de l'exécution (`side`), comme pour un ordre. `Close Short`
 * est un achat : LONG vert (décidé le 2026-11-20). Le `dir` de l'exchange ne sert qu'à reconnaître un
 * perp ; tout autre sens (`Buy`, `Long > Short`, une liquidation) s'écrit tel quel en capitales : un
 * sens que l'on ne classe pas ne se devine pas. Un `dir` vide retombe sur BUY / SELL.
 */
export function fillSideBadge(fill: { dir?: string | null; side: 'A' | 'B' }): SideBadge {
  const isBuy = fill.side === 'B';
  const tone: SideBadge['tone'] = isBuy ? 'success' : 'danger';
  const dir = fill.dir?.trim() ?? '';
  if (FILL_DIR.test(dir)) return { text: isBuy ? 'LONG' : 'SHORT', tone };
  return { text: dir ? dir.toUpperCase() : isBuy ? 'BUY' : 'SELL', tone };
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
