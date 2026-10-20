import { MarketMetaError } from '@utils/market-meta.util';

/**
 * ============================================================================
 * CE QUE LE FORMULAIRE SAIT DE LA GRILLE DU MARCHÉ — ET CE QU'IL IGNORE
 *
 * `szDecimals` règle la taille et le prix qui PARTENT vers l'exchange (`roundSize` et `roundPrice`
 * arrondissent). Tant qu'il n'est pas lu dans la méta **du bon marché**, l'envoi est donc bloqué : un
 * ordre arrondi sur la grille d'un autre marché déplace la taille ou le prix saisis (mesuré : une taille
 * 12,5 partait à 13, une limite 0,52345 à 0,52). C'est le même principe que `active-asset.util.ts` pour le
 * prix : l'option qui échoue **bruyamment et tôt**.
 *
 * Avant le 2026-10-19 la grille était cherchée par sous-chaîne, et un échec — marché absent, méta qui ne
 * charge pas — ne disait rien : `szDecimals` gardait le défaut `3` ou la valeur de l'actif précédent.
 * ============================================================================
 */

/**
 * - `none` : aucun actif choisi — les autres validations parlent déjà ;
 * - `loading` : la grille est en cours de lecture (court) ;
 * - `ok` : la grille est celle du marché choisi ;
 * - `missing` : la méta est arrivée, mais ce marché n'y est pas lisible (absent, ambigu, grille illisible) ;
 * - `unsupported` : le marché est connu, mais d'un genre que l'app ne négocie pas (un outcome, HIP-4) ;
 * - `unavailable` : la méta n'a pas pu être chargée (transport).
 */
export type MarketMetaState = 'none' | 'loading' | 'ok' | 'missing' | 'unsupported' | 'unavailable';

/**
 * L'état qu'impose l'échec d'une lecture : un marché illisible ou non négocié (`MarketMetaError`) ne se répare
 * pas en réessayant ; une méta qui n'a pas chargé, si.
 */
export function marketMetaStateOf(error: unknown): 'missing' | 'unsupported' | 'unavailable' {
  if (!(error instanceof MarketMetaError)) return 'unavailable';
  return error.code === 'unsupported' ? 'unsupported' : 'missing';
}

/** Le détail de l'échec, pour le message : la raison que la lecture a donnée, ou rien. */
export function marketMetaDetailOf(error: unknown): string | null {
  return error instanceof MarketMetaError ? error.message : null;
}

/**
 * Tant que la grille n'est pas celle du marché choisi, l'envoi est bloqué. `none` ne bloque pas ici :
 * sans actif, c'est « aucun actif choisi » qui l'empêche.
 */
export function blocksOnMarketMeta(state: MarketMetaState): boolean {
  return (
    state === 'loading' || state === 'missing' || state === 'unsupported' || state === 'unavailable'
  );
}

/**
 * Le message qui accompagne le blocage : un bouton désactivé sans raison dite est une défaillance muette.
 * `loading` n'en a pas — c'est un état de quelques instants, pas une erreur, et un bandeau rouge qui
 * clignote serait pire que le bouton qui attend.
 */
export function marketMetaNotice(
  state: MarketMetaState,
  coin: string,
  detail: string | null,
): string | null {
  switch (state) {
    case 'missing':
      return `The size and price grid of "${coin}" could not be read${detail ? ` (${detail})` : ''}, so placing an order is disabled.`;
    case 'unsupported':
      // Le détail dit déjà quel genre de marché c'est (`"#10" is an outcome market (HIP-4), …`) : le répéter
      // en préfixe serait redire.
      return `${detail ?? `"${coin}" is a market this app does not trade`}, so placing an order is disabled.`;
    case 'unavailable':
      return 'Market metadata could not be loaded, so the size and price grid are unknown. Placing an order is disabled until it loads.';
    case 'none':
    case 'loading':
    case 'ok':
      return null;
  }
}
