export interface User {
  _id: string;
  username: string;
  walletAddress: string;
  tradingSettings?: Record<string, BotSettings>;
  updatedAt: string;
  createdAt: string;
}

export type ExitBehavior = 'STRATEGY_SIGNAL' | 'EXIT_ON_PROFIT_ONLY' | 'NEVER';

export interface StrategyParameterOption {
  label: string;
  value: any;
}

export interface StrategyParameter {
  id: string;
  label: string;
  type: 'select' | 'number' | 'boolean';
  options?: StrategyParameterOption[];
  default: any;
}

export interface TradingStrategy {
  name: string;
  shortname: string;
  protective?: ProtectiveOrderStrategy;
  parameters?: StrategyParameter[];
}

export interface TradingPair {
  name: string;
  ratio: number;
  interval: string;
  enabled: boolean;
  strategy: TradingStrategy;
  exitBehavior?: ExitBehavior;
  strategyParameters?: Record<string, any>;
}

export interface BotSettings {
  name: string;
  enabled: boolean;
  pairs: TradingPair[];
}

// ─── Protective order types ───────────────────────────────────────────────────

export type TpslType = 'tp' | 'sl';

export interface ProtectiveOrderEntry {
  tpsl: TpslType;
  atrMultiplier: number;
  sizePercent: number;
}

export interface ProtectiveOrderStrategy {
  entries: ProtectiveOrderEntry[];
}
