import type { AnalysisStrategyRequest } from '@syldel/trading-shared-types';
import type { StrategyRef, WatchlistItem } from '../../watchlist/models/watchlist-item.model';
import {
  STRATEGY_DOCUMENT_SCHEMA_VERSION,
  type StrategyDocument,
} from '../models/strategy-document.model';

/**
 * ============================================================================
 * 🔁 LEGACY STRATEGY MIGRATION
 * Reprise des `WatchlistItem` écrits avant la bibliothèque, quand un chart
 * portait une **copie** complète de sa stratégie
 * (`activeStrategy?: AnalysisStrategyRequest | null`).
 *
 * Chaque copie porteuse de règles devient un document de bibliothèque — en
 * **conservant son `id`**, ce qui rend la migration idempotente et garde un
 * sens à la référence : deux charts qui pointaient sur la même stratégie
 * retombent sur le même document au lieu d'en créer deux.
 *
 * Une copie sans `rules` (stratégie codée en dur choisie dans une ancienne
 * version) n'a rien à reprendre : le champ est simplement retiré.
 *
 * Fonction pure : elle ne persiste rien et ne connaît aucun service. C'est
 * l'appelant qui écrit les documents récupérés dans la bibliothèque puis les
 * éléments migrés — dans cet ordre, pour qu'une référence ne pointe jamais
 * dans le vide.
 * ============================================================================
 */

/** Forme historique, telle qu'elle dort encore dans Preferences. */
type LegacyWatchlistItem = WatchlistItem & {
  activeStrategy?: AnalysisStrategyRequest | null;
};

export interface LegacyStrategyMigrationResult {
  items: WatchlistItem[];
  /** Documents à écrire dans la bibliothèque avant de persister `items`. */
  recovered: StrategyDocument[];
  /** `false` si rien n'était à migrer — l'appelant peut alors ne rien réécrire. */
  changed: boolean;
}

export function migrateLegacyWatchlistStrategies(
  items: readonly WatchlistItem[],
  now: number = Date.now(),
): LegacyStrategyMigrationResult {
  const recovered = new Map<string, StrategyDocument>();
  let changed = false;

  const migrated = items.map((item) => {
    const legacy = item as LegacyWatchlistItem;
    if (!('activeStrategy' in legacy)) return item;

    changed = true;
    const { activeStrategy, ...rest } = legacy;

    if (!activeStrategy?.rules) return rest as WatchlistItem;

    if (!recovered.has(activeStrategy.id)) {
      recovered.set(activeStrategy.id, {
        id: activeStrategy.id,
        name: activeStrategy.name,
        rules: activeStrategy.rules,
        createdAt: now,
        updatedAt: now,
        schemaVersion: STRATEGY_DOCUMENT_SCHEMA_VERSION,
      });
    }

    const alreadyReferenced = (rest.strategyRefs ?? []).some(
      (ref) => ref.strategyId === activeStrategy.id,
    );
    const ref: StrategyRef = { strategyId: activeStrategy.id, visible: true };

    return {
      ...rest,
      strategyRefs: alreadyReferenced ? rest.strategyRefs : [...(rest.strategyRefs ?? []), ref],
    } as WatchlistItem;
  });

  return {
    items: changed ? migrated : [...items],
    recovered: [...recovered.values()],
    changed,
  };
}
