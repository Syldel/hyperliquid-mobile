import type { IExchangeStrategy, StrategyMeta } from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 🚦 PAIR STRATEGY STATUS
 * Le bot peut-il exécuter cette paire, et ce build a-t-il le droit d'en juger ?
 *
 * `HlTradingEngineService.getHyperliquidStrategyData` aiguille sur
 * `pair.strategy?.shortname?.toLowerCase().trim()` : une valeur absente ou
 * inconnue ne tombe dans aucune branche, la paire est ignorée à chaque cycle.
 * Deux paires du compte de développement sont exactement dans ce cas —
 * `{ name: 'Neural Momentum Strategy' }`, sans `shortname`, `enabled: true` —
 * et rien nulle part ne le disait : ni la liste (badge identique à une paire
 * saine), ni le moteur (aucun log, voir le correctif joint côté bot).
 *
 * D'où cette partition, et surtout son quatrième état. Le catalogue fait
 * autorité (ecosystem.md) mais il arrive du réseau : tant qu'il n'est pas là,
 * un `shortname` présent n'est **pas** vérifiable, et accuser une paire sur
 * une absence de réponse serait exactement la « décision que le client n'a pas
 * le droit de prendre » que ce dépôt refuse ailleurs. Seul « pas de
 * `shortname` » se tranche sans catalogue : le bot aiguille dessus, il n'y a
 * rien sur quoi aiguiller, et aucune version future du bot n'y changera rien.
 * ============================================================================
 */

export type PairStrategyStatus =
  /** `shortname` présent et servi par le catalogue de cet exchange. */
  | 'ok'
  /** Aucun `shortname` exploitable — certain, y compris sans catalogue. */
  | 'missing-shortname'
  /** `shortname` présent, absent du catalogue servi — le bot ne le propose plus. */
  | 'unknown-shortname'
  /** Catalogue indisponible : ce build ne sait pas, et ne prétend pas savoir. */
  | 'unverified';

/**
 * La stratégie d'une paire **telle qu'elle dort en base**, par opposition au
 * type que le paquet partagé décrit aujourd'hui.
 *
 * `IExchangeStrategy.shortname` est déclaré obligatoire ; les documents écrits
 * avant cette contrainte n'en portent pas. Le type mentait donc sur la donnée
 * réelle, ce qui est très précisément la raison pour laquelle le cas n'avait
 * jamais été traité : rien à la compilation ne suggérait qu'il existait. Le
 * dire ici remet la divergence sous les yeux de l'appelant.
 */
export type StoredPairStrategy = Omit<IExchangeStrategy, 'shortname'> & { shortname?: string };

/**
 * @param catalogue Les stratégies servies par `GET /exchanges/meta` **pour
 * l'exchange de cette paire**. `null` signifie « pas encore chargé, ou bot
 * injoignable » ; `[]` signifie « le bot ne propose rien pour cet exchange »,
 * ce qui est une réponse, pas une absence de réponse.
 */
export function pairStrategyStatus(
  strategy: StoredPairStrategy | undefined,
  catalogue: readonly StrategyMeta[] | null,
): PairStrategyStatus {
  const shortname = routingKey(strategy?.shortname);
  if (!shortname) return 'missing-shortname';

  if (catalogue === null) return 'unverified';

  const offered = catalogue.some((meta) => routingKey(meta.shortname) === shortname);
  return offered ? 'ok' : 'unknown-shortname';
}

/**
 * `true` si ce build est **certain** que le bot n'exécutera pas la paire.
 *
 * Nommée plutôt que recopiée dans deux gabarits : la liste et la modale
 * doivent signaler exactement les mêmes cas, et `unverified` n'en fait pas
 * partie — ne pas savoir n'est pas un défaut de la paire.
 */
export function isKnownUnexecutable(status: PairStrategyStatus): boolean {
  return status === 'missing-shortname' || status === 'unknown-shortname';
}

/**
 * La forme sous laquelle le moteur compare un `shortname`. Reproduite à
 * l'identique (`toLowerCase().trim()`) plutôt qu'approchée : une paire que le
 * bot exécute grâce à sa tolérance de casse ne doit pas être signalée ici
 * comme inexécutable, et l'inverse encore moins.
 */
function routingKey(value: string | undefined): string {
  return (value ?? '').toLowerCase().trim();
}
