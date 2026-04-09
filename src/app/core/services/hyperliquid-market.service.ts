import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConfigService } from '@services/config.service';
import { HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';
import { map, Observable, of, tap } from 'rxjs';

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class HyperliquidMarketService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);

  private perpCache: CacheEntry<HLPerpMeta> | null = null;
  private spotCache: CacheEntry<HLSpotMeta> | null = null;

  private post<T>(body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidPublicUrl}/info`, body);
  }

  // ------------------------------------------------------------------ //
  //  Perp
  // ------------------------------------------------------------------ //

  getPerpMeta(): Observable<HLPerpMeta> {
    if (this.perpCache && Date.now() < this.perpCache.expiresAt) {
      return of(this.perpCache.data);
    }
    return this.post<HLPerpMeta>({ type: 'meta' }).pipe(tap((data) => this.setCache('perp', data)));
  }

  /** Returns only active (non-delisted) perp names, e.g. ["BTC", "ETH", …] */
  getPerpNames(): Observable<string[]> {
    return this.getPerpMeta().pipe(
      map((meta) => meta.universe.filter((m) => !m.isDelisted).map((m) => m.name)),
    );
  }

  // ------------------------------------------------------------------ //
  //  Spot
  // ------------------------------------------------------------------ //

  getSpotMeta(): Observable<HLSpotMeta> {
    if (this.spotCache && Date.now() < this.spotCache.expiresAt) {
      return of(this.spotCache.data);
    }
    return this.post<HLSpotMeta>({ type: 'spotMeta' }).pipe(
      tap((data) => this.setCache('spot', data)),
    );
  }

  getSpotNames(): Observable<string[]> {
    return this.getSpotMeta().pipe(
      map((meta) => {
        const tokensByIndex: Record<number, string> = {};
        meta.tokens.forEach((t) => {
          tokensByIndex[t.index] = t.name;
        });

        return meta.universe
          .filter((pair) => !pair.name.startsWith('@') || !pair.isCanonical)
          .map((pair) => {
            if (pair.isCanonical) {
              return pair.name;
            } else {
              return pair.tokens.map((idx) => tokensByIndex[idx]).join('/');
            }
          });
      }),
    );
  }

  // ------------------------------------------------------------------ //
  //  Cache helpers
  // ------------------------------------------------------------------ //

  private setCache(type: 'perp', data: HLPerpMeta): void;
  private setCache(type: 'spot', data: HLSpotMeta): void;
  private setCache(type: 'perp' | 'spot', data: HLPerpMeta | HLSpotMeta): void {
    const entry = { data, expiresAt: Date.now() + CACHE_DURATION_MS };
    if (type === 'perp') this.perpCache = entry as CacheEntry<HLPerpMeta>;
    else this.spotCache = entry as CacheEntry<HLSpotMeta>;
  }

  /** Manually invalidate one or both caches (e.g. on pull-to-refresh). */
  clearCache(target: 'perp' | 'spot' | 'all' = 'all'): void {
    if (target === 'perp' || target === 'all') this.perpCache = null;
    if (target === 'spot' || target === 'all') this.spotCache = null;
  }
}
