import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CANDLE_INTERVAL_MINUTES,
  CandleInterval,
  CandleSnapshot,
  CandleSnapshotRequest,
} from '@syldel/hl-shared-types';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConfigService } from './config.service';

interface CacheEntry {
  data: CandleSnapshot[];
  /** Heure de **réception** de la réponse, sur l'horloge du téléphone. */
  fetchedAt: number;
}

/** Des bougies, et l'heure à laquelle elles ont été reçues d'Hyperliquid. */
export interface TimedCandles {
  candles: CandleSnapshot[];
  readAt: number;
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

  /**
   * Les bougies d'une fenêtre, servies depuis le cache tant qu'elles ont moins de `CACHE_TTL`.
   *
   * `fresh` saute la **lecture** du cache, pas son écriture : la réponse neuve remplace l'entrée, et le
   * prochain appel ordinaire la sert. Sans cette écriture, un changement d'intervalle aller-retour juste
   * après un rafraîchissement forcé ramenait le chart aux bougies d'avant.
   */
  getCandles(
    req: CandleSnapshotRequest,
    options: { fresh?: boolean } = {},
  ): Observable<CandleSnapshot[]> {
    return this.getCandlesWithTime(req, options).pipe(map(({ candles }) => candles));
  }

  /**
   * `getCandles`, avec l'heure à laquelle ces bougies ont été reçues — qu'elles sortent du cache ou d'une
   * lecture neuve. Le chart l'affiche (« as of 21:45:12 ») : servir le cache est un compromis accepté,
   * le cacher ne l'est pas.
   */
  getCandlesWithTime(
    req: CandleSnapshotRequest,
    options: { fresh?: boolean } = {},
  ): Observable<TimedCandles> {
    const endTime = req.endTime ?? Date.now();
    const startTime = req.startTime ?? 0;
    const ttl = CACHE_TTL[req.interval] ?? 15_000;
    const roundedEnd = Math.floor(endTime / ttl) * ttl;
    const roundedStart = Math.floor(startTime / ttl) * ttl;
    const key = `${req.coin}:${req.interval}:${roundedStart}:${roundedEnd}`;
    const entry = this.cache.get(key);
    const now = Date.now();

    if (!options.fresh && entry && now - entry.fetchedAt < ttl) {
      return of({ candles: entry.data, readAt: entry.fetchedAt });
    }

    return this.post<CandleSnapshot[]>({
      type: 'candleSnapshot',
      req,
    }).pipe(
      map((data) => {
        // L'heure de réception, et non celle de l'envoi (`now`) comme jusqu'au 2026-11-15 : c'est elle
        // qui s'affiche. L'écart, la durée de l'appel, ne change rien au TTL.
        const fetchedAt = Date.now();
        this.cache.set(key, { data, fetchedAt });
        return { candles: data, readAt: fetchedAt };
      }),
    );
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
