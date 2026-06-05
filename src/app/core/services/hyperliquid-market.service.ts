import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConfigService } from '@services/config.service';
import { HLPerpDex, HLPerpDexsResponse, HLPerpMeta, HLSpotMeta } from '@syldel/hl-shared-types';
import { map, Observable, of, switchMap, tap } from 'rxjs';

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface CacheMap {
  spot: HLSpotMeta;
  hip3: HLPerpDex[];
}

type CacheStore = { [K in keyof CacheMap]: CacheEntry<CacheMap[K]> | null };

@Injectable({ providedIn: 'root' })
export class HyperliquidMarketService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);

  private cache: CacheStore = { spot: null, hip3: null };

  // Cache perp unifié par dex ('' = dex natif HL)
  private perpCache = new Map<string, CacheEntry<HLPerpMeta>>();

  private post<T>(body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidPublicUrl}/info`, body);
  }

  // ------------------------------------------------------------------ //
  //  Perp
  // ------------------------------------------------------------------ //

  getPerpMeta(dex = ''): Observable<HLPerpMeta> {
    const entry = this.perpCache.get(dex);
    if (entry && Date.now() < entry.expiresAt) return of(entry.data);
    return this.post<HLPerpMeta>({ type: 'meta', ...(dex && { dex }) }).pipe(
      tap((data) => this.perpCache.set(dex, { data, expiresAt: Date.now() + CACHE_DURATION_MS })),
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

  clearCache(target: keyof CacheMap | 'perp' | 'all' = 'all'): void {
    if (target === 'all' || target === 'perp') this.perpCache.clear();
    if (target === 'all') {
      (Object.keys(this.cache) as (keyof CacheMap)[]).forEach((k) => (this.cache[k] = null));
    } else if (target !== 'perp') {
      this.cache[target] = null;
    }
  }

  // ------------------------------------------------------------------ //
  //  Asset Index
  // ------------------------------------------------------------------ //

  getAssetIndex(coin: string): Observable<number> {
    // ── Spot : "TOKEN/USDC" ──────────────────────────────────────────────
    if (coin.includes('/')) {
      return this.getSpotMeta().pipe(
        map((meta) => {
          const idx = meta.universe.findIndex((pair) => pair.name === coin);
          if (idx === -1) throw new Error(`Spot asset not found for coin: ${coin}`);
          // asset = 10000 + spotInfo["index"]
          return 10000 + meta.universe[idx].index;
        }),
      );
    }

    // ── HIP-3 / builder-deployed perp : "dex:COIN" ──────────────────────
    if (coin.includes(':')) {
      const dex = this.extractDex(coin); // "vntl", "test", etc.
      return this.getPerpDexs().pipe(
        switchMap((dexs) => {
          const perpDexIndex = dexs.findIndex((d) => d.name === dex);
          if (perpDexIndex === -1) throw new Error(`PerpDex not found for dex: ${dex}`);
          return this.getPerpMeta(dex).pipe(
            map((meta) => {
              const indexInMeta = meta.universe.findIndex((a) => a.name === coin);
              if (indexInMeta === -1)
                throw new Error(`Asset not found in perpDex meta for coin: ${coin}`);
              // asset = 100000 + perp_dex_index * 10000 + index_in_meta
              return 100000 + perpDexIndex * 10000 + indexInMeta;
            }),
          );
        }),
      );
    }

    // ── Perp natif HL : "BTC", "ETH", etc. ──────────────────────────────
    const entry = this.perpCache.get('');
    const universe = entry?.data?.universe;
    if (universe) {
      const idx = universe.findIndex((a) => a.name === coin);
      if (idx !== -1) return of(idx);
    }
    return this.getPerpMeta('').pipe(
      map((meta) => {
        const idx = meta.universe.findIndex((a) => a.name === coin);
        if (idx === -1) throw new Error(`Perp asset not found for coin: ${coin}`);
        return idx;
      }),
    );
  }

  private extractDex(pairName: string): string {
    const parts = pairName.split(':');
    return parts.length > 1 ? parts[0] : '';
  }
}
