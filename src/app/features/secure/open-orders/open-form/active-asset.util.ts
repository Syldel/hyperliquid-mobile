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

/**
 * « Le prix n'a pas pu être chargé » : l'échec de `activeAssetData`.
 *
 * Il était rendu par `null`, que le layout lit comme « vide » : tout le formulaire
 * disparaissait derrière « No data found », sans toast. Un marqueur non nul garde le
 * formulaire affiché, pour pouvoir **dire** l'échec. Mesuré le 2026-10-16.
 */
export const ACTIVE_ASSET_UNAVAILABLE = Object.freeze({
  kind: 'active-asset-unavailable',
} as const);

export type ActiveAssetUnavailable = typeof ACTIVE_ASSET_UNAVAILABLE;

/**
 * Un actif **spot** : `activeAssetData` est une requête de perps, et l'API répond 500 pour
 * un actif spot (mesuré sur `PURR/USDC`, 1 actif — pas sur tous). Plutôt que d'envoyer une
 * requête qui échoue à coup sûr, on dit que le contrôle de prix n'existe pas pour le spot.
 */
export const PRICE_CHECK_UNSUPPORTED = Object.freeze({ kind: 'price-check-unsupported' } as const);

export type PriceCheckUnsupported = typeof PRICE_CHECK_UNSUPPORTED;

/** Tout ce que `RefreshableLayout` peut remettre à `onDataLoaded` pour ce formulaire. */
export type ActiveAssetPayload =
  | HlActiveAssetData
  | NoAssetSelected
  | ActiveAssetUnavailable
  | PriceCheckUnsupported
  | null;

/** Ce que le formulaire sait du marché de l'actif choisi. */
export type MarketDataState = 'none' | 'ok' | 'unavailable' | 'unsupported';

export type ActiveAssetReading =
  /** Rien à lire (aucun actif choisi, ou chargement échoué) : l'état en place ne bouge pas. */
  | { status: 'none' }
  | { status: 'ok'; price: number; leverage: HlActiveAssetLeverage }
  /** Une réponse est arrivée, mais son `markPx` n'est pas un prix : on le dit, on n'en fait pas un `NaN`. */
  | { status: 'unreadable-price'; raw: unknown; leverage: HlActiveAssetLeverage }
  /** L'appel a échoué : le prix n'est pas connu. */
  | { status: 'unavailable' }
  /** Le contrôle de prix n'existe pas pour ce marché (spot). */
  | { status: 'unsupported' };

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

export function isNoAssetSelected(data: ActiveAssetPayload): data is NoAssetSelected {
  return data === NO_ASSET_SELECTED;
}

/**
 * Les trois marqueurs, reconnus par **identité** : un objet de même forme ne passe pas. Le
 * garde de type est ce qui permet à TypeScript de réduire l'union — une comparaison
 * `data === MARQUEUR` ne le fait pas.
 */
function isMarker(
  data: ActiveAssetPayload,
): data is NoAssetSelected | ActiveAssetUnavailable | PriceCheckUnsupported {
  return (
    data === NO_ASSET_SELECTED ||
    data === ACTIVE_ASSET_UNAVAILABLE ||
    data === PRICE_CHECK_UNSUPPORTED
  );
}

export function readActiveAsset(data: ActiveAssetPayload): ActiveAssetReading {
  if (data === null) return { status: 'none' };
  if (isMarker(data)) {
    if (data === ACTIVE_ASSET_UNAVAILABLE) return { status: 'unavailable' };
    if (data === PRICE_CHECK_UNSUPPORTED) return { status: 'unsupported' };
    return { status: 'none' };
  }

  const price = readMarkPrice(data.markPx);
  if (price === null) {
    return { status: 'unreadable-price', raw: data.markPx, leverage: data.leverage };
  }
  return { status: 'ok', price, leverage: data.leverage };
}

/**
 * L'état de marché que impose une lecture, ou `null` quand la lecture dit seulement
 * « rien à lire » : l'état en place ne bouge pas.
 *
 * Un prix illisible compte comme indisponible : dans les deux cas le formulaire n'a pas de
 * prix, et c'est de l'absence de prix que découle tout le reste.
 */
export function marketDataStateOf(reading: ActiveAssetReading): MarketDataState | null {
  switch (reading.status) {
    case 'none':
      return null;
    case 'ok':
      return 'ok';
    case 'unreadable-price':
    case 'unavailable':
      return 'unavailable';
    case 'unsupported':
      return 'unsupported';
  }
}

/**
 * Sans prix, `isPriceInvalid` rend `false` : le garde-fou « un achat limite ne passe pas
 * au-dessus du marché » cesse de s'exercer, et un ordre ainsi placé s'exécuterait aussitôt
 * comme taker. Tant que le prix manque, l'envoi est donc bloqué — l'option qui échoue
 * bruyamment et tôt.
 */
export function blocksPlacement(state: MarketDataState): boolean {
  return state === 'unavailable' || state === 'unsupported';
}

/** Le message qui accompagne le blocage : un bouton désactivé sans raison dite est une défaillance muette. */
export function marketDataNotice(state: MarketDataState): string | null {
  switch (state) {
    case 'unavailable':
      return 'Market data could not be loaded, so the price check cannot run. Placing an order is disabled until it loads.';
    case 'unsupported':
      return 'The price check is not available for spot markets yet, so placing an order from this form is disabled.';
    case 'none':
    case 'ok':
      return null;
  }
}
