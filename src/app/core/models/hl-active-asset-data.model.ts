export interface HlActiveAssetLeverage {
  type: 'cross' | 'isolated';
  value: number;
  rawUsd?: string; // uniquement en isolated, marge en USD
}

export interface HlActiveAssetData {
  user: string;
  coin: string;
  leverage: HlActiveAssetLeverage;
  maxTradeSzs: [string, string]; // [long, short] taille max
  availableToTrade: [string, string]; // [long, short] disponible
  markPx: string; // prix mark courant
}
