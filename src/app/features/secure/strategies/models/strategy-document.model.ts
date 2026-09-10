import type {
  AnalysisStrategyRequest,
  IExchangeStrategy,
  StrategyParameter,
  StrategyRules,
} from '@syldel/trading-shared-types';

/**
 * ============================================================================
 * 📄 STRATEGY DOCUMENT
 * Une stratégie telle que la bibliothèque la conserve : les règles, plus ce
 * qu'il faut pour la retrouver et la rouvrir.
 *
 * `rules` est **exactement** le type partagé, sans conversion : le même objet
 * est backtesté par `POST /analysis`, validé par
 * `POST /exchanges/strategies/validate` et exécuté par le bot. Les adaptateurs
 * ci-dessous ne font qu'emballer, jamais transformer.
 * ============================================================================
 */

/** Incrémenter uniquement si la forme du document change de façon non rétrocompatible. */
export const STRATEGY_DOCUMENT_SCHEMA_VERSION = 1;

export interface StrategyDocument {
  id: string;
  name: string;
  description?: string;
  rules: StrategyRules;
  createdAt: number;
  updatedAt: number;
  /**
   * Version de forme du document au moment de l'écriture. Sert aussi de
   * marqueur de provenance : un `schemaVersion` supérieur à
   * `STRATEGY_DOCUMENT_SCHEMA_VERSION` signale un document écrit par un build
   * plus récent, donc susceptible de contenir des nœuds que celui-ci ne sait
   * pas interpréter (voir strategy-issues.util.ts).
   */
  schemaVersion: number;
}

/**
 * `shortname` de la famille de stratégies pilotée par un arbre de règles.
 *
 * Ce n'est pas une étiquette décorative : le bot aiguille dessus
 * (`pair.strategy?.shortname?.toLowerCase().trim()` dans
 * `HlTradingEngineService`), et `'advanced-rules'` est la seule valeur pour
 * laquelle il exécute réellement `StrategyRules`. Toute autre valeur ferait
 * ignorer l'arbre en silence — d'où une constante unique, partagée par la
 * validation et par l'écriture d'une paire du bot, plutôt qu'une chaîne
 * recopiée à chaque appel.
 */
export const ADVANCED_RULES_SHORTNAME = 'advanced-rules';

/** `true` si le document vient d'un build plus récent que celui-ci. */
export function isFromNewerSchema(document: StrategyDocument): boolean {
  return document.schemaVersion > STRATEGY_DOCUMENT_SCHEMA_VERSION;
}

/** Emballage pour un backtest (`POST /analysis`) — l'`id` du document sert d'`id` de série de signaux. */
export function toAnalysisRequest(document: StrategyDocument): AnalysisStrategyRequest {
  return {
    id: document.id,
    name: document.name,
    rules: document.rules,
  };
}

/**
 * Emballage pour la validation serveur, et plus tard pour l'écriture d'une
 * paire du bot : un seul adaptateur pour les deux, afin que ce qui est validé
 * soit littéralement ce qui sera exécuté.
 */
export function toExchangeStrategy(document: StrategyDocument): IExchangeStrategy {
  return {
    name: document.name,
    shortname: ADVANCED_RULES_SHORTNAME,
    ...(document.description ? { description: document.description } : {}),
    rules: document.rules,
  };
}

/** Une branche éditable de l'arbre : son chemin relatif et son libellé. */
export interface StrategyBranch {
  /** Suffixe de chemin sous `rules` (`long.entry`), tel que déclaré par `StrategyParameter.id`. */
  id: string;
  label: string;
}

/**
 * Les quatre branches d'une stratégie pilotée par règles.
 *
 * Écrites ici, et non lues depuis `/exchanges/meta`, parce qu'elles ne sont pas
 * un catalogue : `SideRules` est un type fermé du paquet partagé, `long`/`short`
 * × `entry`/`exit` en est la forme exacte. Le serveur les déclare de son côté
 * (`AdvancedRulesStrategyDefinition`) pour piloter un formulaire générique ;
 * l'éditeur les reçoit en entrée, ce qui lui permettra plus tard d'afficher
 * celles qu'une `StrategyMeta` particulière déclare, sans changer de composant.
 */
export const DEFAULT_STRATEGY_BRANCHES: readonly StrategyBranch[] = [
  { id: 'long.entry', label: 'Long entry' },
  { id: 'long.exit', label: 'Long exit' },
  { id: 'short.entry', label: 'Short entry' },
  { id: 'short.exit', label: 'Short exit' },
];

/**
 * Branches éditables déclarées par une entrée du catalogue.
 *
 * `StrategyMeta.parameters` décrit un formulaire ; ses champs `rule-builder`
 * désignent chacun une branche de `rules` par leur `id` (`long.entry`), les
 * autres une clé de `settings`. Lire les branches ici plutôt que d'utiliser
 * `DEFAULT_STRATEGY_BRANCHES` laisse le serveur décider de ce qu'une stratégie
 * donnée expose : une famille future n'ouvrant que le côté long n'aurait pas à
 * afficher deux branches mortes.
 *
 * `[]` pour une stratégie codée en dur — c'est aussi le test « cette stratégie
 * se pilote-t-elle par règles ? ».
 */
export function ruleBranchesOf(
  parameters: readonly StrategyParameter[] | undefined,
): StrategyBranch[] {
  return (parameters ?? [])
    .filter((parameter) => parameter.type === 'rule-builder')
    .map((parameter) => ({ id: parameter.id, label: parameter.label }));
}

/**
 * Document de travail bâti sur la stratégie déjà enregistrée pour une paire du
 * bot, afin de la rouvrir dans le builder.
 *
 * L'`id` vient de l'appelant : `IExchangeStrategy` n'en porte pas, une paire ne
 * peut donc pas se souvenir du document dont elle est issue. Ce que la paire
 * conserve est un instantané, pas une référence — et c'est voulu : éditer une
 * stratégie de la bibliothèque ne doit pas changer en silence ce qu'un bot
 * exécute déjà.
 *
 * `schemaVersion` repart de la version courante pour la même raison : rien
 * dans `IExchangeStrategy` ne dit quel build a écrit ces règles.
 */
export function toStrategyDocument(strategy: IExchangeStrategy, id: string): StrategyDocument {
  const now = Date.now();

  return {
    id,
    name: strategy.name,
    ...(strategy.description ? { description: strategy.description } : {}),
    rules: strategy.rules ?? {},
    createdAt: now,
    updatedAt: now,
    schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
  };
}
