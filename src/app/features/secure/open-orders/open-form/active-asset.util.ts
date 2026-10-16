import type { HlActiveAssetData, HlActiveAssetLeverage } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * CE QUE LE FORMULAIRE D'ORDRE SAIT DE L'ACTIF CHOISI — ET CE QU'IL IGNORE
 *
 * `RefreshableLayout` n'affiche son contenu que si la donnée chargée n'est ni
 * `null` ni vide : il lui faut donc **quelque chose** à « charger » même quand
 * aucun actif n'est encore choisi, sinon le formulaire lui-même disparaît.
 *
 * Ce « quelque chose » était `{ fake: true } as any`, émis tel quel jusqu'à
 * `onDataLoaded`, qui lisait `data.markPx` (absent) : `parseFloat(undefined)`
 * rend `NaN`, le signal `currentPrice` le gardait, et le gabarit écrit
 * `placeholder="{{ currentPrice() ?? '0.00' }}"` — or `NaN ?? '0.00'` vaut `NaN`.
 * Mesuré le 2026-10-16 : le champ « Limit price » affichait **« NaN »** tant
 * qu'aucun actif n'était choisi. Le `any` masquait le défaut ; typer le faux
 * objet honnêtement faisait échouer le build du gabarit, ce qui l'a révélé.
 *
 * Désormais : un marqueur **nommé et typé**, et une lecture qui dit ce qu'elle a
 * trouvé plutôt que de laisser passer un `NaN`.
 * ============================================================================
 */

/**
 * « Aucun actif choisi » : rend le layout non vide sans prétendre être une donnée
 * de marché. Gelé, pour qu'aucun appelant ne puisse en faire un faux relevé.
 */
export const NO_ASSET_SELECTED = Object.freeze({ kind: 'no-asset-selected' } as const);

export type NoAssetSelected = typeof NO_ASSET_SELECTED;

export type ActiveAssetReading =
  /** Rien à lire (aucun actif choisi, ou chargement échoué) : l'état en place ne bouge pas. */
  | { status: 'none' }
  | { status: 'ok'; price: number; leverage: HlActiveAssetLeverage }
  /** Une réponse est arrivée, mais son `markPx` n'est pas un prix : on le dit, on n'en fait pas un `NaN`. */
  | { status: 'unreadable-price'; raw: unknown; leverage: HlActiveAssetLeverage };

/**
 * Une chaîne décimale simple, sans signe ni notation scientifique : la forme que
 * l'exchange envoie. `Number('')` vaut **0** et `parseFloat('12abc')` vaut 12 :
 * ni l'un ni l'autre ne vaut validation (même raison que `requireFinite` côté bot).
 */
const DECIMAL = /^\d+(\.\d+)?$/;

/** Un cours de marché est strictement positif : zéro n'est pas un prix. */
function readMarkPrice(raw: unknown): number | null {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isNoAssetSelected(
  data: HlActiveAssetData | NoAssetSelected | null,
): data is NoAssetSelected {
  return data === NO_ASSET_SELECTED;
}

export function readActiveAsset(
  data: HlActiveAssetData | NoAssetSelected | null,
): ActiveAssetReading {
  if (data === null || isNoAssetSelected(data)) return { status: 'none' };

  const price = readMarkPrice(data.markPx);
  if (price === null) {
    return { status: 'unreadable-price', raw: data.markPx, leverage: data.leverage };
  }
  return { status: 'ok', price, leverage: data.leverage };
}
