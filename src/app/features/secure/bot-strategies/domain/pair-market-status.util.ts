import type { HLPerpMarketInfo } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * 🪦 PAIR MARKET STATUS
 * Le marché de cette paire existe-t-il encore, et ce build a-t-il le droit
 * d'en juger ?
 *
 * Relevé le 2026-09-30 : `vntl:ROBOT` était configurée sur l'écran Bot
 * Strategies — ratio 15 %, intervalle 60, trois protections — alors que
 * `meta({dex:'vntl'})` rend **15 actifs sur 15 délistés**. Rien ne le disait,
 * ni dans l'app ni dans le bot. Deux autres dex du même compte étaient dans le
 * même état, éteints par annonce officielle : `cash` (17/17, sunset du
 * 30 juin 2026) et `hyna` (25/25, sunset du 31 août 2026).
 *
 * Pourquoi ça n'a pas sauté aux yeux : `perpDexs` **continue de les servir**.
 * C'est un registre de déploiements, pas un catalogue de marchés vivants — il
 * rendait encore les dix dex le jour du relevé. Le seul signal de vie est
 * `meta({dex}).universe[].isDelisted`, que le mobile ne lisait jusqu'ici que
 * dans le sélecteur de marché, c'est-à-dire **au moment de choisir** une
 * paire et jamais après. Le bot et le gateway ne le lisent nulle part
 * (0 occurrence), alors que le gateway le transmet pourtant (`{index,
 * ...asset}`).
 *
 * Et ce n'est pas une affaire de HIP-3 : sur le **dex principal**, 56 marchés
 * sur 234 sont délistés au même relevé — MATIC, RNDR, FTM. Une paire héritée
 * sur l'un d'eux serait exactement dans l'état de `vntl:ROBOT`.
 *
 * `isDelisted` est un champ **documenté** de `meta` (doc Hyperliquid, exemple
 * `LOOM`), et non un champ deviné. La doc y montre aussi ce qui fonde la
 * partition ci-dessous : un marché délisté **reste entièrement décrit** dans
 * l'univers, drapeau en plus. « Délisté » et « absent du catalogue » sont donc
 * deux situations distinctes de l'API, pas deux façons de dire la même chose.
 *
 * La partition reprend celle de [`pair-strategy-status.util`], son quatrième
 * état compris, et pour la même raison : le catalogue arrive du réseau.
 * Condamner une paire parce que la réponse n'est pas encore là serait
 * exactement la décision qu'un client n'a pas le droit de prendre.
 * ============================================================================
 */

export type PairMarketStatus =
  /** Marché servi par le catalogue et non délisté. */
  | 'ok'
  /** Marché servi et marqué délisté — certain. */
  | 'delisted'
  /** Catalogue chargé, marché absent : il n'existe pas — certain. */
  | 'unknown-market'
  /** Ce build ne sait pas, et ne prétend pas savoir. Deux causes distinctes,
   *  volontairement confondues parce qu'elles portent la même affirmation —
   *  aucune : le catalogue n'est pas encore arrivé, **ou** le marché est un
   *  marché spot, dont Hyperliquid ne publie aucun drapeau de délistage. */
  | 'unverified';

/**
 * Ce que le domaine a besoin de savoir des catalogues perp, sans rien
 * connaître des services qui les chargent.
 */
export interface PerpMarketCatalogue {
  /**
   * Les dex servis par `perpDexs`. `null` signifie « réponse pas encore là » ;
   * un tableau signifie que la liste fait autorité, donc qu'un dex absent
   * n'existe pas.
   */
  readonly dexNames: readonly string[] | null;
  /**
   * Univers perp par dex (`''` = dex principal). Une **clé absente** signifie
   * « pas encore chargé » ; un tableau **vide** est une réponse du catalogue,
   * pas une absence — le dex est servi et ne porte aucun marché.
   */
  readonly universeByDex: ReadonlyMap<string, readonly HLPerpMarketInfo[]>;
}

/**
 * Le dex dont il faut charger l'univers pour juger cette paire, ou `null`
 * quand le catalogue perp n'a rien à en dire.
 *
 * Les deux formes de nom sont **documentées**, elles ne sont pas déduites :
 * la doc « Asset IDs » pose qu'un perp déployé par un builder porte
 * *toujours* un nom `{dex}:{coin}`, et qu'une paire spot se désigne par
 * `10000 + spotInfo.index` — d'où la forme protocolaire `@<index>`. Son
 * exemple HYPE (token 150, spot 107) recoupe exactement le relevé du
 * 2026-09-30 : le solde porte `token: 150`, la paire s'appelle `@107`.
 *
 * ⚠️ La détection du spot ne peut donc pas se réduire à la barre oblique :
 * sur 330 paires spot, seules les canoniques portent un nom `BASE/QUOTE`.
 * Sans le test sur `@`, toutes les autres tomberaient dans la branche perp,
 * seraient cherchées en vain dans l'univers du dex principal, et un marché
 * vivant serait signalé comme inexistant.
 */
export function dexToLoadFor(pairName: string): string | null {
  if (!pairName) return null;
  if (pairName.includes('/') || pairName.startsWith('@')) return null;

  const separator = pairName.indexOf(':');
  return separator === -1 ? '' : pairName.slice(0, separator);
}

export function pairMarketStatus(
  pairName: string,
  catalogue: PerpMarketCatalogue,
): PairMarketStatus {
  const dex = dexToLoadFor(pairName);
  if (dex === null) return 'unverified';

  const universe = catalogue.universeByDex.get(dex);
  if (universe === undefined) {
    // L'univers manque. Le registre, lui, peut déjà trancher : s'il est chargé
    // et ne sert pas ce dex, aucune requête ultérieure ne le fera apparaître.
    const registryDeniesTheDex =
      dex !== '' && catalogue.dexNames !== null && !catalogue.dexNames.includes(dex);

    return registryDeniesTheDex ? 'unknown-market' : 'unverified';
  }

  // Le nom porté par l'univers est le nom complet, préfixe compris
  // (`vntl:ROBOT`, `para:TOTAL2`) : la comparaison est directe, et exacte.
  const market = universe.find((entry) => entry.name === pairName);
  if (!market) return 'unknown-market';

  return market.isDelisted ? 'delisted' : 'ok';
}

/**
 * `true` si ce build est **certain** que le marché ne peut pas être traité.
 *
 * Nommée plutôt que recopiée, pour la même raison que son homologue du statut
 * de stratégie : la liste et la modale doivent signaler exactement les mêmes
 * cas, et `unverified` n'en fait pas partie.
 */
export function isKnownUnexecutableMarket(status: PairMarketStatus): boolean {
  return status === 'delisted' || status === 'unknown-market';
}

/**
 * Les dex dont il faut charger l'univers pour juger **cet ensemble** de paires,
 * dédoublonnés.
 *
 * Le dédoublonnage vit ici et non chez l'appelant : deux paires d'un même dex
 * ne doivent pas valoir deux requêtes vers Hyperliquid pour la même réponse.
 */
export function dexesToLoad(pairNames: readonly string[]): string[] {
  const dexes = new Set<string>();

  for (const pairName of pairNames) {
    const dex = dexToLoadFor(pairName);
    if (dex !== null) dexes.add(dex);
  }

  return [...dexes];
}

/** Ce que `perpDexs` dit d'un dex, réduit à ce dont l'affichage a besoin. */
export interface PerpDexSummary {
  readonly name: string;
  readonly fullName?: string | null;
}

/**
 * Le nom lisible d'un dex pour un message à l'utilisateur, ou `null` quand on
 * n'en a pas — auquel cas le libellé reste générique plutôt que d'inventer.
 *
 * Trois `null` distincts se confondent volontairement, parce qu'ils appellent
 * la même phrase : le dex principal, un dex que le registre ne sert pas, et un
 * registre pas encore arrivé.
 *
 * Le dex principal n'a délibérément **pas** de garde à lui : `perpDexs` ne
 * sert que les HIP-3 et le représente par un `null` de tête, donc la recherche
 * ci-dessous ne peut pas le trouver et rend `null` d'elle-même. Un
 * `if (!dex)` a bien été écrit ici, puis retiré — la passe de mutation a
 * montré qu'aucun test ne tombait sans lui, ce qui est la définition d'un
 * garde mort.
 *
 * @param dexes La réponse `perpDexs` telle quelle, `null` de tête compris —
 * c'est la forme réelle, et la recopier évite de la retraiter deux fois.
 */
export function dexLabel(
  dex: string,
  dexes: readonly (PerpDexSummary | null)[] | null,
): string | null {
  if (dexes === null) return null;

  const summary = dexes.find((entry) => entry?.name === dex);
  if (!summary) return null;

  // Un `fullName` vide n'est pas un libellé : mieux vaut la clé technique
  // qu'un blanc au milieu d'une phrase.
  return summary.fullName || summary.name;
}
