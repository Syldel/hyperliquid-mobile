export type ChartInterval = '15' | '60' | '240' | '1D' | (string & {});

export interface ExchangeStrategy {
  name: string;
  shortname: string;
}

export interface ExchangeFormMetadata {
  intervals: ChartInterval[];
  exchanges: string[];
  strategies: Record<string, ExchangeStrategy[]>;
}
