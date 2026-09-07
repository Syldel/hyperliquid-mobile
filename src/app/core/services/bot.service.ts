import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ExchangesMetaResponse,
  IndicatorMetadata,
  PACKAGE_VERSION,
} from '@syldel/trading-shared-types';
import { map, Observable, of, shareReplay, tap } from 'rxjs';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class BotService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private metadataCache = signal<ExchangesMetaResponse | null>(null);
  private metadataCachedAt: number | null = null;
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000;

  private inFlight$: Observable<ExchangesMetaResponse> | null = null;

  getExchangeFormMetadata(): Observable<ExchangesMetaResponse> {
    const now = Date.now();
    const cached = this.metadataCache();

    if (cached && this.metadataCachedAt && now - this.metadataCachedAt < this.CACHE_TTL) {
      return of(cached);
    }

    if (this.inFlight$) return this.inFlight$;

    this.inFlight$ = this.http
      .get<ExchangesMetaResponse>(`${this.config.botServiceUrl}/exchanges/meta`)
      .pipe(
        tap((meta) => {
          this.metadataCache.set(meta);
          this.metadataCachedAt = Date.now();
        }),
        shareReplay(1),
        tap({ finalize: () => (this.inFlight$ = null) } as any),
      );

    return this.inFlight$;
  }

  invalidateMetadataCache(): void {
    this.metadataCache.set(null);
    this.metadataCachedAt = null;
  }

  readonly exitBehaviors = computed(() => this.metadataCache()?.globalOptions.exitBehaviors ?? []);

  readonly exitBehaviorLabels = computed(
    () =>
      Object.fromEntries(this.exitBehaviors().map((eb) => [eb.value, eb.label])) as Record<
        string,
        string
      >,
  );

  getIndicatorMeta(name: string): Observable<IndicatorMetadata | undefined> {
    return this.getExchangeFormMetadata().pipe(
      map((m) => m.indicators.find((i) => i.name === name)),
    );
  }

  readonly indicators = computed(() => this.metadataCache()?.indicators ?? []);

  /**
   * Version de `@syldel/trading-shared-types` compilée dans CE build mobile —
   * fixe pour toute la durée de vie de l'app, contrairement à `metadataCache`.
   */
  readonly localPackageVersion = PACKAGE_VERSION;

  /** Version du même paquet réellement exécutée par le bot, telle que renvoyée par `/exchanges/meta`. */
  readonly serverPackageVersion = computed(() => this.metadataCache()?.packageVersion ?? null);

  /**
   * `true` uniquement une fois `serverPackageVersion` connu et différent du
   * build local — jamais avant le premier `getExchangeFormMetadata()` réussi,
   * pour ne pas afficher une fausse alerte pendant le chargement initial.
   *
   * Une dérive ici signifie que le catalogue (indicateurs, transforms,
   * grammaire du rule-builder) que ce build sait interpréter n'est plus
   * exactement celui que le bot exécute — voir mobile-app-integration.md
   * (nest-trading-bot) pour l'incident qui a motivé ce garde-fou.
   */
  readonly hasPackageVersionMismatch = computed(() => {
    const server = this.serverPackageVersion();
    return server !== null && server !== this.localPackageVersion;
  });
}
