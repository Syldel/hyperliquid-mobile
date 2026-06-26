import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { HyperliquidInfoService } from './hyperliquid-info.service';

const SPOT_STABLECOIN_FALLBACK = ['USDC', 'USDT', 'USDT0', 'USDE'] as const;

interface CacheEntry {
  value: number;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class AvailableCapitalService {
  private readonly hlInfo = inject(HyperliquidInfoService);

  private readonly TTL_MS = 5_000;
  private readonly cache = new Map<string, CacheEntry>();

  getAvailableCapital(dex: string, pairName: string): Observable<number> {
    const isSpot = pairName.includes('/');
    const cacheKey = `${dex ?? 'hl'}:${isSpot ? 'spot' : 'perp'}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return of(cached.value);
    }

    const request$ = isSpot ? this.resolveSpotCapital() : this.resolvePerpCapital(dex);

    return request$.pipe(
      tap((value) => this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.TTL_MS })),
    );
  }

  private resolveSpotCapital(): Observable<number> {
    return this.hlInfo.getTokenBalances().pipe(
      map((balances) => {
        for (const stable of SPOT_STABLECOIN_FALLBACK) {
          const entry = balances.find((b) => b.coin === stable && parseFloat(b.total) > 0);
          if (entry) return parseFloat(entry.total);
        }
        return 0;
      }),
    );
  }

  private resolvePerpCapital(dex: string): Observable<number> {
    return this.hlInfo
      .getClearinghouseState(dex)
      .pipe(map((state) => parseFloat(state.marginSummary.accountValue)));
  }

  invalidate(dex?: string, pairName?: string): void {
    if (!dex && !pairName) {
      this.cache.clear();
      return;
    }
    const isSpot = pairName?.includes('/');
    const cacheKey = `${dex ?? 'hl'}:${isSpot ? 'spot' : 'perp'}`;
    this.cache.delete(cacheKey);
  }
}
