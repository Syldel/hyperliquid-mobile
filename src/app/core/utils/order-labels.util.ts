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

/** Le côté d'un ordre, en capitales : `LONG`, `SHORT`, `CLOSE SHORT`, `CLOSE LONG`, `BUY`, `SELL`. */
export function sideBadgeLabel(coin: string, isBuy: boolean, reduceOnly = false): string {
  if (!isPerpMarket(coin)) return isBuy ? 'BUY' : 'SELL';
  if (reduceOnly) return isBuy ? 'CLOSE SHORT' : 'CLOSE LONG';
  return isBuy ? 'LONG' : 'SHORT';
}

/**
 * Le sens d'un remplissage, tel que l'exchange l'écrit dans `dir` (`Open Long`, `Close Short`,
 * `Buy`, `Long > Short`…), en capitales. Un `dir` vide retombe sur le côté plutôt que d'afficher
 * une pastille vide.
 */
export function fillDirectionLabel(fill: { dir?: string | null; side: 'A' | 'B' }): string {
  const dir = fill.dir?.trim();
  if (dir) return dir.toUpperCase();
  return fill.side === 'B' ? 'BUY' : 'SELL';
}

/**
 * Le sens des trois TIF d'Hyperliquid, pour le détail et le formulaire. Les listes n'affichent que
 * le code (`tifLabel`).
 */
const TIF_MEANINGS: Record<string, string> = {
  GTC: 'Good till cancelled',
  ALO: 'Post only',
  IOC: 'Immediate or cancel',
};

/** Le code d'un TIF en capitales : `Alo` → `ALO`. */
export function tifLabel(tif: string): string {
  return tif.toUpperCase();
}

/** `ALO – Post only`. Un TIF inconnu de cette table s'affiche par son seul code, sans sens deviné. */
export function tifDescription(tif: string): string {
  const code = tifLabel(tif);
  const meaning = TIF_MEANINGS[code];
  return meaning ? `${code} – ${meaning}` : code;
}
