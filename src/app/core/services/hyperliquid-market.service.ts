import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConfigService } from '@services/config.service';
import { HLPerpDex, HLPerpDexsResponse, HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';
import { map, Observable, of, tap } from 'rxjs';

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface CacheMap {
  perp: HLPerpMeta;
  spot: HLSpotMeta;
  hip3: HLPerpDex[];
}

type CacheStore = { [K in keyof CacheMap]: CacheEntry<CacheMap[K]> | null };

@Injectable({ providedIn: 'root' })
export class HyperliquidMarketService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);

  private cache: CacheStore = {
    perp: null,
    spot: null,
    hip3: null,
  };

  private post<T>(body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidPublicUrl}/info`, body);
  }

  // ------------------------------------------------------------------ //
  //  Perp
  // ------------------------------------------------------------------ //

  getPerpMeta(): Observable<HLPerpMeta> {
    const cached = this.getCache('perp');
    if (cached) return of(cached);
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
    const cached = this.getCache('spot');
    if (cached) return of(cached);
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
  //  HIP-3 / PerpDexs
  // ------------------------------------------------------------------ //

  getPerpDexs(): Observable<HLPerpDex[]> {
    const cached = this.getCache('hip3');
    if (cached) return of(cached);
    return this.post<HLPerpDexsResponse>({ type: 'perpDexs' }).pipe(
      map((res) => res.filter((d): d is HLPerpDex => d !== null)),
      tap((data) => this.setCache('hip3', data)),
    );
  }

  /** Returns the list of PerpDex short names, e.g. ["test", "myDex", …] */
  getPerpDexNames(): Observable<string[]> {
    return this.getPerpDexs().pipe(map((dexs) => dexs.map((d) => d.name)));
  }

  // ------------------------------------------------------------------ //
  //  Cache helpers
  // ------------------------------------------------------------------ //

  private setCache<K extends keyof CacheMap>(type: K, data: CacheMap[K]): void {
    (this.cache as Record<K, CacheEntry<CacheMap[K]> | null>)[type] = {
      data,
      expiresAt: Date.now() + CACHE_DURATION_MS,
    };
  }

  private getCache<K extends keyof CacheMap>(type: K): CacheMap[K] | null {
    const entry = (this.cache as Record<K, CacheEntry<CacheMap[K]> | null>)[type];
    return entry && Date.now() < entry.expiresAt ? entry.data : null;
  }

  clearCache(target: keyof CacheMap | 'all' = 'all'): void {
    if (target === 'all') {
      (Object.keys(this.cache) as (keyof CacheMap)[]).forEach((k) => (this.cache[k] = null));
    } else {
      this.cache[target] = null;
    }
  }
}
