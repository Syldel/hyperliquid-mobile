import { IExchange, IExchangePair } from '@syldel/trading-shared-types';

// TODO: Nest has a similar External User model (src/interfaces/external-user.interface.ts).
// Not yet shared via @syldel/trading-shared-types — worth comparing shapes and migrating
// this to the shared package once confirmed they represent the same concept (or splitting
// into a shared "core" User + an Angular-only extension, similar to how TradingPair extends
// IExchangePair).
export interface ExternalUser {
  _id: string;
  username: string;
  walletAddress: string;
  tradingSettings?: Record<string, IExchange>;
  updatedAt: string;
  createdAt: string;
}

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
