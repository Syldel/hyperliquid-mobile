import type { StrategyMeta } from '@syldel/trading-shared-types';
import { routingKey } from './pair-strategy-status.util';

/**
 * ============================================================================
 * 📚 CATALOGUE D'UN EXCHANGE
 * Quelles stratégies le bot déclare-t-il **pour cet exchange**, et ce build
 * a-t-il de quoi répondre ?
 *
 * `ExchangesMetaResponse.strategies` est un `Record<string, StrategyMeta[]>`
 * dont la clé est le nom d'exchange. L'aplatir (`Object.values(...).flat()`)
 * revient à proposer les stratégies d'un exchange sur un autre : invisible
 * tant que le bot n'en déclare qu'un, faux dès qu'il y en a deux. Le défaut
 * avait été écrit plutôt que corrigé (roadmap, « à ne pas oublier »), et il
 * s'était dédoublé — le sélecteur, le statut de la paire et la ré-association
 * en édition appliquaient trois règles différentes. D'où ce module : une seule
 * décision, quatre situations nommées.
 *
 * `undeclared` n'est pas `not-loaded`. La liste `exchanges` servie par le bot
 * est dérivée du même enregistrement : un exchange absent du catalogue est un
 * exchange pour lequel le bot ne propose rien, ce qui est une réponse. Le même
 * raisonnement est écrit sur `BotStrategiesPage.strategyStatus`, qui juge les
 * paires de la liste ; les deux doivent rester d'accord.
 * ============================================================================
 */
export type ExchangeCatalogue =
  /** Aucun exchange choisi : la question n'a pas encore de sens. */
  | { state: 'no-exchange' }
  /** Le catalogue n'a pas répondu — ni liste, ni verdict. */
  | { state: 'not-loaded' }
  /** Le bot a répondu et ne déclare rien pour cet exchange. */
  | { state: 'undeclared'; exchangeKey: string }
  /** Le bot déclare ces stratégies, et elles seules, pour cet exchange. */
  | { state: 'served'; exchangeKey: string; strategies: StrategyMeta[] };

/**
 * @param byExchange `ExchangesMetaResponse.strategies`, ou `null` tant que
 * `GET /exchanges/meta` n'a pas répondu. `{}` est une réponse vide, pas une
 * absence de réponse — d'où le `null` explicite plutôt qu'un test sur la
 * taille de l'objet.
 */
export function exchangeCatalogue(
  byExchange: Record<string, StrategyMeta[]> | null,
  exchangeKey: string | null | undefined,
): ExchangeCatalogue {
  const key = (exchangeKey ?? '').trim();
  if (!key) return { state: 'no-exchange' };
  if (byExchange === null) return { state: 'not-loaded' };

  const strategies = byExchange[key];
  if (!strategies) return { state: 'undeclared', exchangeKey: key };

  return { state: 'served', exchangeKey: key, strategies };
}

/**
 * Les stratégies à proposer dans un sélecteur.
 *
 * Vide partout ailleurs que `served` : ne rien proposer est exact, alors que
 * retomber sur le catalogue aplati offrirait des stratégies que le bot
 * n'exécutera pas sur cet exchange. Un sélecteur vide se justifie à l'écran
 * (voir `undeclaredExchange` dans la modale des paires), il ne se comble pas.
 */
export function offeredStrategies(catalogue: ExchangeCatalogue): StrategyMeta[] {
  return catalogue.state === 'served' ? catalogue.strategies : [];
}

/**
 * La même chose, sous la forme qu'attend `pairStrategyStatus` : `null` quand
 * rien ne fait autorité, `[]` quand le bot a répondu qu'il ne propose rien.
 *
 * C'est le point où les deux vocabulaires se rejoignent : `undeclared` vaut
 * `[]` et fait donc rendre `unknown-shortname` — la paire est bel et bien
 * signalée. Le *motif* réel (l'exchange entier n'est pas servi) reste à dire
 * à l'utilisateur ; le statut seul ne suffit pas à le formuler.
 */
export function judgeableCatalogue(catalogue: ExchangeCatalogue): readonly StrategyMeta[] | null {
  switch (catalogue.state) {
    case 'served':
      return catalogue.strategies;
    case 'undeclared':
      return [];
    default:
      return null;
  }
}

/**
 * Retrouve l'entrée de catalogue d'un `shortname` enregistré.
 *
 * La comparaison passe par `routingKey`, comme `pairStrategyStatus` : les deux
 * répondaient auparavant sur des règles différentes (`===` strict ici,
 * `toLowerCase().trim()` là-bas), si bien qu'une paire que le bot exécute
 * grâce à sa tolérance de casse était jugée saine **et** laissait le sélecteur
 * vide, sans un mot. Un trou muet : exactement ce que ce dépôt refuse.
 */
export function resolveStrategyMeta(
  catalogue: ExchangeCatalogue,
  shortname: string | undefined,
): StrategyMeta | undefined {
  const key = routingKey(shortname);
  if (!key) return undefined;

  return offeredStrategies(catalogue).find((meta) => routingKey(meta.shortname) === key);
}
