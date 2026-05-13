import { ExitBehavior, StrategyParameter } from './user.interface';

export type ChartInterval = '15' | '60' | '240' | '1D' | (string & {});

export interface ExchangeStrategy {
  name: string;
  shortname: string;
  parameters?: StrategyParameter[];
}

export interface ExitBehaviorMeta {
  label: string;
  value: ExitBehavior;
  description: string;
}

export interface GlobalOptions {
  exitBehaviors: ExitBehaviorMeta[];
}

export interface ExchangeFormMetadata {
  intervals: ChartInterval[];
  exchanges: string[];
  strategies: Record<string, ExchangeStrategy[]>;
  globalOptions: GlobalOptions;
}
