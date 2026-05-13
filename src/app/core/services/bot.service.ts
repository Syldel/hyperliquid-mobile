import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { ExchangeFormMetadata } from '@models/bot.interfaces';
import { Observable, of, tap } from 'rxjs';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class BotService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private metadataCache = signal<ExchangeFormMetadata | null>(null);
  private metadataCachedAt: number | null = null;
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000;

  getExchangeFormMetadata(): Observable<ExchangeFormMetadata> {
    const now = Date.now();
    const cached = this.metadataCache();

    if (cached && this.metadataCachedAt && now - this.metadataCachedAt < this.CACHE_TTL) {
      return of(cached);
    }

    return this.http.get<ExchangeFormMetadata>(`${this.config.botServiceUrl}/exchanges/meta`).pipe(
      tap((meta) => {
        this.metadataCache.set(meta);
        this.metadataCachedAt = Date.now();
      }),
    );
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
}
