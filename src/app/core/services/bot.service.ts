import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ExchangesMetaResponse,
  IExchangeStrategy,
  IndicatorMetadata,
  IndicatorRequest,
  PACKAGE_VERSION,
  StrategyValidationResult,
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

  /**
   * Verdict autoritaire sur une stratégie, avant de l'attacher à un chart ou de
   * l'envoyer au bot.
   *
   * Complète — sans la remplacer — la validation locale
   * (`collectStrategyRulesIssues`) : celle-ci est instantanée mais s'appuie sur
   * une copie compilée des catalogues, potentiellement en retard sur ceux que
   * le serveur exécute. Un client ne doit jamais traiter son propre verdict
   * comme final (voir `CATALOG_DEPENDENT_ISSUE_CODES` et
   * `docs/trading/mobile-app-integration.md` côté bot).
   *
   * Répond `200` même pour une stratégie invalide : le rapport d'anomalies
   * *est* la réponse attendue, pas une erreur HTTP.
   */
  validateStrategy(strategy: IExchangeStrategy): Observable<StrategyValidationResult> {
    return this.http.post<StrategyValidationResult>(
      `${this.config.botServiceUrl}/exchanges/strategies/validate`,
      { strategy },
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

  getIndicatorMeta(name: string): Observable<IndicatorMetadata | undefined> {
    return this.getExchangeFormMetadata().pipe(
      map((m) => m.indicators.find((i) => i.name === name)),
    );
  }

  readonly indicators = computed(() => this.metadataCache()?.indicators ?? []);

  /**
   * Libellés des énumérations du rule-builder, tels que servis par
   * `/exchanges/meta` — jamais la copie compilée `RULE_BUILDER_GRAMMAR`, dont
   * l'import comme valeur est interdit côté mobile (no-catalog-imports.spec.ts).
   * `null` tant que les métadonnées ne sont pas chargées : le builder doit
   * attendre plutôt que d'afficher des sélecteurs vides.
   */
  readonly ruleBuilderGrammar = computed(
    () => this.metadataCache()?.strategyFormSchema.ruleBuilderGrammar ?? null,
  );

  /**
   * Clé sous laquelle `POST /analysis` range la série d'un indicateur dans
   * `AnalysisResponse.indicators` (ex: `ema_9`, `macd_12_26_9`).
   *
   * Reconstruite depuis `IndicatorMetadata.parameters` — **ordre et valeurs par
   * défaut servis par le bot** — et non via `buildIndicatorKeyFromOperand` du
   * paquet compilé, dont l'import comme valeur est d'ailleurs interdit ici
   * (no-catalog-imports.spec.ts). La raison est concrète : ce helper complète
   * les paramètres omis avec `INDICATOR_DEFAULTS` **compilé**, si bien qu'un
   * `ema` sans période explicite donnerait `ema_9` côté mobile et `ema_12` côté
   * serveur dès que le registre du bot change. Seul le *format* de la clé est
   * dupliqué ici ; c'est de la grammaire, pas du catalogue.
   *
   * `null` si l'indicateur est absent du catalogue chargé : l'appelant doit
   * alors renoncer à la série plutôt que de l'attribuer au hasard.
   *
   * Pas de `subField` : les séries de chart sont demandées via
   * `IndicatorRequest`, qui n'en porte pas — un sous-champ n'existe que sur un
   * opérande de règle.
   */
  buildIndicatorKey(request: IndicatorRequest): string | null {
    const meta = this.indicators().find((indicator) => indicator.name === request.name);
    if (!meta) return null;

    if (meta.parameters.length === 0) return request.name;

    const provided = request as unknown as Record<string, unknown>;
    const values = meta.parameters.map((parameter) =>
      provided[parameter.name] !== undefined ? provided[parameter.name] : parameter.defaultValue,
    );

    return `${request.name}_${values.join('_')}`;
  }

  /**
   * Ordre canonique des lignes d'un indicateur multi-sorties, tel que renvoyé
   * par le bot (`IndicatorMetadata.subFields`) — jamais dérivé d'un registre
   * compilé localement, pour ne jamais diverger d'un catalogue backend plus
   * récent que ce build (voir no-catalog-imports.spec.ts). `[]` pour un
   * indicateur mono-ligne ou absent du catalogue actuellement chargé.
   */
  getIndicatorSubFieldNames(name: string): string[] {
    return (
      this.indicators()
        .find((i) => i.name === name)
        ?.subFields?.map((sf) => sf.name) ?? []
    );
  }

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
