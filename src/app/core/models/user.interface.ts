export interface User {
  _id: string;
  username: string;
  walletAddress: string;
  tradingSettings?: Record<string, BotSettings>;
  updatedAt: string;
  createdAt: string;
}

export interface TradingStrategy {
  name: string;
  shortname: string;
  // source?: string;
}

export interface TradingPair {
  name: string;
  ratio: number;
  interval: string;
  enabled: boolean;
  strategy: TradingStrategy;
}

export interface BotSettings {
  name: string;
  enabled: boolean;
  pairs: TradingPair[];
}
