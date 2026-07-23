import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CANDLE_INTERVAL_MINUTES,
  CandleInterval,
  CandleSnapshot,
  CandleSnapshotRequest,
} from '@syldel/hl-shared-types';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ConfigService } from './config.service';

interface CacheEntry {
  data: CandleSnapshot[];
  fetchedAt: number;
}

/** TTL cache par interval = (durée de la bougie) / 4, plancher à 15s. Derived from
 * CANDLE_INTERVAL_MINUTES (hl-shared-types) — single source of truth, mirrors the
 * same computation used on the Nest side, no local duplicate of the raw ms table. */
const CACHE_TTL: Record<CandleInterval, number> = Object.fromEntries(
  Object.entries(CANDLE_INTERVAL_MINUTES).map(([interval, minutes]) => {
    const intervalMs = minutes * 60 * 1000;
    return [interval, Math.max(intervalMs / 4, 15_000)];
  }),
) as Record<CandleInterval, number>;

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

  intervalToMs(interval: CandleInterval): number {
    return (CANDLE_INTERVAL_MINUTES[interval] ?? 60) * 60 * 1000;
  }
}
