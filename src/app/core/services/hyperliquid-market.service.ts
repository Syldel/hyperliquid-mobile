import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConfigService } from '@services/config.service';
import {
  hlMarketKind,
  hlPerpDexOf,
  HLPerpDexsResponse,
  HLPerpMeta,
  HLSpotMeta,
} from '@syldel/hl-shared-types';
import { isSpotMarket } from '@utils/market-kind.util';
import {
  MarketMetaError,
  readPerpMarketMeta,
  readSpotMarketMeta,
  type MarketMeta,
} from '@utils/market-meta.util';
import { forkJoin, map, Observable, of, switchMap, tap, throwError } from 'rxjs';

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface CacheMap {
  spot: HLSpotMeta;
  hip3: HLPerpDexsResponse;
}

interface HLToken {
  index: number;
  name: string;
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

  private readonly HYPERUNIT_TOKENS = new Set(['UBTC', 'UETH', 'USOL']);

  private spotNameMap: Map<string, string> | null = null;
  private spotProtocolMap: Map<string, string> | null = null;

  private buildSpotMaps(meta: HLSpotMeta): void {
    const tokensByIndex: Record<number, HLToken> = {};
    meta.tokens.forEach((t) => (tokensByIndex[t.index] = t));

    this.spotNameMap = new Map();
    this.spotProtocolMap = new Map();

    meta.universe.forEach((pair) => {
      if (pair.tokens.length < 2) return;
      const base = tokensByIndex[pair.tokens[0]];
      const quote = tokensByIndex[pair.tokens[1]];
      if (!base || !quote) return;

      const protocolName = pair.index === 0 ? 'PURR/USDC' : `@${pair.index}`;
      const officialName = `${base.name}/${quote.name}`;
      const isHyperunit = this.HYPERUNIT_TOKENS.has(base.name);
      const displayName = isHyperunit
        ? `${base.name.substring(1)}/${quote.name}` // "BTC/USDC"
        : pair.isCanonical
          ? pair.name
          : officialName;

      // name map : toutes les clés connues → nom d'affichage
      this.spotNameMap!.set(protocolName, displayName);
      this.spotNameMap!.set(officialName, displayName);
      if (isHyperunit) this.spotNameMap!.set(displayName, displayName);

      // protocol map : toutes les clés connues → nom protocole API
      this.spotProtocolMap!.set(protocolName, protocolName);
      this.spotProtocolMap!.set(officialName, protocolName);
      if (isHyperunit) this.spotProtocolMap!.set(displayName, protocolName);
    });
  }

  private getSpotMaps(): Observable<{
    nameMap: Map<string, string>;
    protocolMap: Map<string, string>;
  }> {
    if (this.spotNameMap && this.spotProtocolMap) {
      return of({ nameMap: this.spotNameMap, protocolMap: this.spotProtocolMap });
    }
    return this.getSpotMeta().pipe(
      tap((meta) => this.buildSpotMaps(meta)),
      map(() => ({ nameMap: this.spotNameMap!, protocolMap: this.spotProtocolMap! })),
    );
  }

  /**
   * Le nom d'affichage de chaque paire spot, dans l'ordre de `spotMeta`. Les noms de protocole sont les
   * valeurs de `protocolMap` (`@N`, et `PURR/USDC` pour la première) : on les lit là, plutôt que de les
   * reconnaître à leur forme dans les clés de `nameMap`, qui porte aussi les noms officiels.
   */
  getSpotNames(): Observable<string[]> {
    return this.getSpotMaps().pipe(
      map(({ nameMap, protocolMap }) =>
        [...new Set(protocolMap.values())].map(
          (protocolName) => nameMap.get(protocolName) ?? protocolName,
        ),
      ),
    );
  }

  resolveCoinName(coin: string): Observable<string> {
    if (!isSpotMarket(coin)) return of(coin);
    return this.getSpotMaps().pipe(map(({ nameMap }) => nameMap.get(coin) ?? coin));
  }

  resolveToProtocolName(coin: string): Observable<string> {
    if (!isSpotMarket(coin)) return of(coin);
    return this.getSpotMaps().pipe(map(({ protocolMap }) => protocolMap.get(coin) ?? coin));
  }

  private resolvedCoins = new Map<string, string>();

  resolveCoin(coin: string): Observable<string> {
    const cached = this.resolvedCoins.get(coin);
    if (cached) return of(cached);
    return this.resolveCoinName(coin).pipe(tap((name) => this.resolvedCoins.set(coin, name)));
  }

  resolveCoins(coins: string[]): Observable<Map<string, string>> {
    const unresolved = [...new Set(coins)].filter((c) => !this.resolvedCoins.has(c));

    if (unresolved.length === 0) return of(new Map(this.resolvedCoins));

    const requests = unresolved.map((coin) =>
      this.resolveCoinName(coin).pipe(
        map((name): { coin: string; name: string } => ({ coin, name })),
      ),
    );

    return forkJoin(requests).pipe(
      tap((results) => results.forEach(({ coin, name }) => this.resolvedCoins.set(coin, name))),
      map(() => new Map(this.resolvedCoins)),
    );
  }

  displayCoin(coin: string): string {
    return this.resolvedCoins.get(coin) ?? coin;
  }

  // ------------------------------------------------------------------ //
  //  HIP-3 / PerpDexs
  // ------------------------------------------------------------------ //

  getPerpDexs(): Observable<HLPerpDexsResponse> {
    const cached = this.getCache('hip3');
    if (cached) return of(cached);
    return this.post<HLPerpDexsResponse>({ type: 'perpDexs' }).pipe(
      tap((data) => this.setCache('hip3', data)),
    );
  }

  /** Returns the list of PerpDex short names, e.g. ["test", "myDex", …] */
  // getPerpDexNames(): Observable<string[]> {
  //   return this.getPerpDexs().pipe(map((dexs) => dexs.flatMap((d) => (d ? [d.name] : []))));
  // }

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

  /**
   * L'identifiant d'actif que portent `order` et `cancel`, selon ce que `hlMarketKind` dit du nom :
   *
   * - **spot** — `PURR/USDC`, un nom d'affichage, ou `@N` — : `10000 + spotInfo["index"]` ;
   * - **perp de builder** (`dex:coin`) : `100000 + perp_dex_index * 10000 + index_in_meta` ;
   * - **perp natif** : son index dans `meta` ;
   * - **tout le reste** : une erreur, jamais une branche par défaut.
   *
   * Source : doc « Asset IDs », relue le 2026-10-19. Avant, la branche spot se décidait par `includes('/')` :
   * sous leur nom brut, 333 des 334 paires spot (`@N`) tombaient dans la branche perp (« Perp asset not found »)
   * et leur ordre ne s'annulait pas depuis l'app (lu dans le code, jamais exécuté).
   */
  getAssetIndex(coin: string): Observable<number> {
    const kind = hlMarketKind(coin);

    // ── Spot : "TOKEN/USDC" ou "@N" ──────────────────────────────────────
    if (kind === 'spot') {
      return this.getSpotMaps().pipe(
        switchMap(({ protocolMap }) => {
          const protocolName = protocolMap.get(coin) ?? coin;
          return this.getSpotMeta().pipe(
            map((meta) => {
              // `universe[].name` est le nom de protocole : `@N`, ou `PURR/USDC` pour l'index 0.
              const pair = meta.universe.find((p) => p.name === protocolName);
              if (!pair) throw new Error(`Spot asset not found for coin: ${coin}`);
              return 10000 + pair.index;
            }),
          );
        }),
      );
    }

    // ── HIP-3 / builder-deployed perp : "dex:COIN" ──────────────────────
    if (kind === 'builderPerp') {
      const dex = hlPerpDexOf(coin); // "vntl", "test", etc.
      return this.getPerpDexs().pipe(
        switchMap((dexs) => {
          const perpDexIndex = dexs.findIndex((d) => d?.name === dex);
          if (perpDexIndex === -1) throw new Error(`PerpDex not found for dex: ${dex}`);
          return this.getPerpMeta(dex ?? '').pipe(
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
    if (kind === 'perp') {
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

    // Un nom que la règle ne classe pas : ni deviné perp du dex principal, ni lu.
    return throwError(
      () =>
        new Error(
          `Cannot resolve the asset index of "${coin}": it is not a market name this app can classify.`,
        ),
    );
  }

  /**
   * La grille d'un marché — `szDecimals`, et `maxLeverage` pour un perp —, lue dans SA méta, par égalité
   * exacte. Voir `market-meta.util.ts` pour ce que la sous-chaîne faisait (38 perps et les 334 paires spot
   * lisaient les données d'un autre).
   *
   * - un **perp** se lit dans la méta de son dex (`hlPerpDexOf`, types partagés) ;
   * - une paire **spot** — `HYPE/USDC` comme `@107` — se rattache à son nom de protocole, puis au jeton de
   *   **base** de la paire ;
   * - un nom que la règle ne sait pas classer est **refusé**, comme un marché absent.
   *
   * Échoue par `MarketMetaError` (le marché n'est pas lisible) ou par l'erreur de transport (la méta n'a pas
   * pu être chargée) : l'appelant distingue les deux, et ne remplace jamais l'une par une valeur par défaut.
   */
  getMarketMeta(coin: string): Observable<MarketMeta> {
    if (hlMarketKind(coin) === 'spot') {
      return this.getSpotMaps().pipe(
        switchMap(({ protocolMap }) => {
          const protocolName = protocolMap.get(coin);
          if (protocolName === undefined) {
            return throwError(
              () => new MarketMetaError('not-found', `"${coin}" is not a known spot pair`),
            );
          }
          return this.getSpotMeta().pipe(map((meta) => readSpotMarketMeta(meta, protocolName)));
        }),
      );
    }

    // `null` pour ce qui n'est pas un perp : un nom que la règle ne sait pas classer n'est ni deviné
    // perp du dex principal, ni lu.
    const dex = hlPerpDexOf(coin);
    if (dex === null) {
      return throwError(
        () => new MarketMetaError('invalid-name', `"${coin}" is not a valid market name`),
      );
    }
    return this.getPerpMeta(dex).pipe(map((meta) => readPerpMarketMeta(meta, coin)));
  }
}
