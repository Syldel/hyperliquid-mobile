import { IExchangePair } from '@syldel/trading-shared-types';

/**
 * Frontend-only extension of IExchangePair: strategyParameters holds the concrete
 * values entered in trading-pair-modal's form (keyed by StrategyParameter.id, e.g.
 * "long.entry"), before being merged into strategy.parameters[].default (or however
 * it's flattened) at save time. Never sent to Nest as a standalone field — if that
 * ever changes, move this back into trading-shared-types instead of duplicating it here.
 */
export interface TradingPair extends IExchangePair {
  strategyParameters?: Record<string, any>;
}
