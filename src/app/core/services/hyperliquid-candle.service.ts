import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CandleSnapshot, CandleSnapshotRequest } from '@syldel/hl-shared-types';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ConfigService } from './config.service';

interface CacheEntry {
  data: CandleSnapshot[];
  fetchedAt: number;
}

const INTERVAL_MS: Record<string, number> = {
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

/** TTL du cache = interval / 4, plancher à 15s. */
const CACHE_TTL: Record<string, number> = Object.fromEntries(
  Object.entries(INTERVAL_MS).map(([k, v]) => [k, Math.max(v / 4, 15_000)]),
);

@Injectable({ providedIn: 'root' })
export class HyperliquidCandleService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);

  private readonly cache = new Map<string, CacheEntry>();

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private post<T>(body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidPublicUrl}/info`, body);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getCandles(req: CandleSnapshotRequest): Observable<CandleSnapshot[]> {
    const endTime = req.endTime ?? Date.now();
    const startTime = req.startTime ?? 0;
    const ttl = CACHE_TTL[req.interval] ?? 15_000;
    const roundedEnd = Math.floor(endTime / ttl) * ttl;
    const roundedStart = Math.floor(startTime / ttl) * ttl;
    const key = `${req.coin}:${req.interval}:${roundedStart}:${roundedEnd}`;
    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry && now - entry.fetchedAt < ttl) {
      return of(entry.data);
    }

    return this.post<CandleSnapshot[]>({
      type: 'candleSnapshot',
      req,
    }).pipe(tap((data) => this.cache.set(key, { data, fetchedAt: now })));
  }

  getRecentCandles(
    coin: string,
    interval: CandleSnapshotRequest['interval'],
    count = 60,
  ): Observable<CandleSnapshot[]> {
    const endTime = Date.now();
    const startTime = endTime - count * this.intervalToMs(interval);
    return this.getCandles({ coin, interval, startTime, endTime });
  }

  // ── Cache management ───────────────────────────────────────────────────────

  /** Invalide le cache pour un coin (et optionnellement un interval précis). */
  invalidate(coin: string, interval?: string): void {
    if (interval) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${coin}:${interval}:`)) this.cache.delete(key);
      }
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${coin}:`)) this.cache.delete(key);
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  // ── Utils ──────────────────────────────────────────────────────────────────

  intervalToMs(interval: string): number {
    return INTERVAL_MS[interval] ?? 3_600_000;
  }
}
