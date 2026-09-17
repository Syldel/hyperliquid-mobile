/**
 * ============================================================================
 * 🏷️ QUI SERT LES MARCHÉS DE CE SÉLECTEUR ?
 *
 * `MarketPickerModalComponent` est **hyperliquid par construction** : il lit
 * `HyperliquidMarketService`, propose les onglets Perp / Spot / HIP-3 et parle
 * en `HLPerpMeta`. Rien là-dedans ne vaut pour un autre exchange.
 *
 * Or la modale des paires du bot l'ouvrait en lui passant l'exchange choisi
 * (`componentProps.exchange`) — et le composant ne lisait jamais cette entrée.
 * Le sélecteur listait donc les marchés Hyperliquid quel que soit l'exchange
 * de la paire, et un nom de marché inconnu du bot pouvait être enregistré sans
 * un mot. Invisible tant que le bot ne déclare qu'un exchange, faux dès qu'il
 * y en a deux : exactement le défaut refermé pour les *stratégies* par
 * `exchange-catalogue.util.ts`, resté ouvert pour le *nom de paire*.
 *
 * La règle retenue est la même que là-bas : **nommer la situation plutôt que
 * replier sur une valeur commode.** Un exchange que ce build ne sait pas
 * lister obtient un refus visible, pas la liste d'un autre.
 * ============================================================================
 */

/**
 * Le seul exchange dont ce build sait lister les marchés.
 *
 * Ce n'est pas une préférence, c'est un constat sur le composant : ajouter un
 * exchange ici sans lui donner sa source de marchés rendrait le refus muet,
 * ce qui est précisément le défaut corrigé.
 */
export const LISTABLE_EXCHANGE = 'hyperliquid';

export type MarketSource =
  /** Aucun exchange transmis : la question n'a pas de réponse, et n'en invente pas. */
  | { state: 'no-exchange' }
  /** Ce build sait lister les marchés de cet exchange. */
  | { state: 'listable'; exchangeKey: string }
  /** Le bot peut déclarer cet exchange ; ce build ne sait pas en lister les marchés. */
  | { state: 'unlistable'; exchangeKey: string };

/**
 * @param exchangeKey la clé telle que le bot la sert dans
 * `ExchangesMetaResponse` — celle-là même qui indexe `strategies`.
 *
 * La comparaison est **exacte après `trim()`**, comme `exchangeCatalogue` :
 * les deux répondent à la même question sur la même clé, et deux règles de
 * comparaison différentes sur un même identifiant sont ce qui avait déjà
 * produit un trou muet. Une clé de casse différente est donc refusée
 * bruyamment plutôt que devinée — un refus se lit à l'écran et se corrige,
 * une supposition juste-assez-juste ne se lit nulle part.
 */
export function marketSource(exchangeKey: string | null | undefined): MarketSource {
  const key = (exchangeKey ?? '').trim();
  if (!key) return { state: 'no-exchange' };

  if (key !== LISTABLE_EXCHANGE) return { state: 'unlistable', exchangeKey: key };

  return { state: 'listable', exchangeKey: key };
}

/**
 * Ce que l'utilisateur doit lire quand aucune liste ne peut être affichée.
 *
 * Le message nomme l'exchange : « rien à proposer » sans dire pourquoi laisserait
 * croire à une panne réseau, alors que la cause est connue et définitive pour ce
 * build.
 *
 * Et il ne propose **aucune** porte de sortie qui n'existe pas. Une première
 * rédaction conseillait de « saisir le nom de la paire à la main » : le champ
 * `pairName` de la modale des paires n'est pas saisissable, il n'est rempli que
 * par ce sélecteur. C'était un diagnostic faux affiché à l'utilisateur — le
 * défaut même que ce dépôt s'est déjà pris une fois (voir les risques de la
 * roadmap côté mobile).
 */
export function refusalMessage(source: MarketSource): string | null {
  switch (source.state) {
    case 'listable':
      return null;
    case 'no-exchange':
      // Cas courant et légitime : une nouvelle paire, dont l'exchange n'est pas
      // encore choisi. Ce n'est pas une anomalie, c'est un ordre à respecter.
      return 'Pick an exchange first — which pairs exist depends on it.';
    case 'unlistable':
      return `This build can only list ${LISTABLE_EXCHANGE} markets, not “${source.exchangeKey}” ones. No pair can be picked here for this exchange.`;
  }
}
