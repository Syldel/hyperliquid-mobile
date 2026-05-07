import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CandleSnapshot, CandleSnapshotRequest } from '@syldel/hl-shared-types';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class HyperliquidCandleService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);

  private post<T>(body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidPublicUrl}/info`, body);
  }

  getCandles(req: CandleSnapshotRequest): Observable<CandleSnapshot[]> {
    return this.post<CandleSnapshot[]>({
      type: 'candleSnapshot',
      req,
    });
  }

  /**
   * Fetch the last `count` candles ending now.
   */
  getRecentCandles(
    coin: string,
    interval: CandleSnapshotRequest['interval'],
    count = 60,
  ): Observable<CandleSnapshot[]> {
    const endTime = Date.now();
    const startTime = endTime - count * this.intervalToMs(interval);
    return this.getCandles({ coin, interval, startTime, endTime });
  }

  intervalToMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60_000,
      '3m': 180_000,
      '5m': 300_000,
      '15m': 900_000,
      '30m': 1_800_000,
      '1h': 3_600_000,
      '2h': 7_200_000,
      '4h': 14_400_000,
      '8h': 28_800_000,
      '12h': 43_200_000,
      '1d': 86_400_000,
      '3d': 259_200_000,
      '1w': 604_800_000,
      '1M': 2_592_000_000,
    };
    return map[interval] ?? 3_600_000;
  }
}
