import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  OnDestroy,
  OnInit,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBadge,
  IonButton,
  IonChip,
  IonIcon,
  IonSkeletonText,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { BotService } from '@services/bot.service';
import { ChartAnalysisService } from '@services/chart-analysis.service';
import { HyperliquidCacheService } from '@services/hyperliquid-cache.service';
import { HyperliquidCandleService } from '@services/hyperliquid-candle.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { IndicatorPickerComponent } from '@shared/components/indicator-picker/indicator-picker.component';
import { ActiveIndicator } from '@shared/components/indicator-picker/models/indicator.model';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import {
  CANDLE_INTERVALS,
  CandleInterval,
  CandleSnapshot,
  HLOrderStatusData,
  HLUserFill,
} from '@syldel/hl-shared-types';
import {
  AnalysisCandle,
  AnalysisRequest,
  AnalysisResponse,
  BacktestSummary,
  IndicatorMetadata,
} from '@syldel/trading-shared-types';
import { toChartInterval } from '@utils/hl-interval.utils';
import { addIcons } from 'ionicons';
import {
  addOutline,
  alertCircleOutline,
  calendarOutline,
  closeCircle,
  createOutline,
  chevronUpOutline,
  receiptOutline,
  refreshOutline,
  statsChartOutline,
} from 'ionicons/icons';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  Time,
  createChart,
} from 'lightweight-charts';
import { firstValueFrom } from 'rxjs';

import { IndicatorOverlayService } from '@shared/components/indicator-picker/services/indicator-overlay.service';
import { formatIndicatorLabel } from '@shared/components/indicator-picker/utils/indicator-label.util';
import { strategyColor } from '../../../strategies/domain/strategy-color.util';
import { isLocallyExecutable } from '../../../strategies/domain/strategy-issues.util';
import { toAnalysisRequest } from '../../../strategies/models/strategy-document.model';
import {
  collectStrategyOperands,
  type StrategyExpression,
} from '../../../strategies/domain/strategy-operands.util';
import {
  isPriceScale,
  scaleGroupOf,
  type ScaleCatalogue,
} from '../../../strategies/domain/operand-scale.util';
import { formatOperand } from '../../../strategies/domain/strategy-format.util';
import { StrategyPickerModalComponent } from '../../../strategies/components/strategy-picker-modal/strategy-picker-modal.component';
import { StrategyLibraryService } from '../../../strategies/services/strategy-library.service';
import {
  DATE_PRESETS,
  DatePreset,
  INTERVAL_LABELS,
  ExpressionRef,
  StrategyRef,
  WatchlistItem,
} from '../../models/watchlist-item.model';
import { StrategyPositionsPaneService } from '../../services/strategy-positions-pane.service';
import { StrategySignalsOverlayService } from '../../services/strategy-signals-overlay.service';
import {
  ExpressionsPaneService,
  PRICE_GROUP,
  type ExpressionLayer,
} from '../../services/expressions-pane.service';
import {
  ExpressionPickerModalComponent,
  type ExpressionRow,
} from '../../components/expression-picker-modal/expression-picker-modal.component';
import {
  toExpressionSeries,
  type ExpressionSeries,
  type RawExpressionPoint,
} from '../../utils/expression-series.util';
import { overlayFailureReason } from '../../utils/overlay-failure.util';
import { WatchlistService } from '../../services/watchlist.service';
import { mapIndicatorSeriesById } from '../../utils/indicator-series-map.util';
import type { StrategySignalLayer } from '../../utils/strategy-markers.util';

/** Une stratégie backtestée sur la fenêtre courante : ses marqueurs, plus son bilan. */
interface StrategyRunResult extends StrategySignalLayer {
  summary: BacktestSummary;
}

@Component({
  selector: 'app-watchlist-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonButton,
    IonSkeletonText,
    IonIcon,
    IonChip,
    IonBadge,
    RefreshableLayoutComponent,
  ],
  providers: [
    IndicatorOverlayService,
    StrategySignalsOverlayService,
    StrategyPositionsPaneService,
    ExpressionsPaneService,
  ],
  templateUrl: './watchlist-detail.page.html',
  styleUrls: ['./watchlist-detail.page.scss'],
})
export class WatchlistDetailPage implements OnInit, OnDestroy {
  private readonly hlCandle = inject(HyperliquidCandleService);
  private readonly hlCache = inject(HyperliquidCacheService);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lifecycle = inject(AppLifecycleService);
  private readonly botService = inject(BotService);
  private readonly chartAnalysis = inject(ChartAnalysisService);
  private readonly indicatorOverlay = inject(IndicatorOverlayService);
  private readonly strategySignals = inject(StrategySignalsOverlayService);
  private readonly strategyPositions = inject(StrategyPositionsPaneService);
  private readonly expressionsPane = inject(ExpressionsPaneService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly watchlistService = inject(WatchlistService);
  private readonly strategyLibrary = inject(StrategyLibraryService);

  // ── View refs ──────────────────────────────────────────────────────────────
  readonly chartEl = viewChild<ElementRef<HTMLDivElement>>('chartEl');
  readonly overlayEl = viewChild<ElementRef<HTMLCanvasElement>>('overlayEl');

  // ── UI state ───────────────────────────────────────────────────────────────
  item = signal<WatchlistItem | null>(null);
  loading = signal(true);
  hasError = signal(false);
  currentPrice = signal<string>('—');
  priceChange = signal<number>(0);
  priceChangeAbs = signal<string>('—');
  backHref = signal('/secure/watchlist');
  selectedInterval = signal<CandleInterval>('1h');
  selectedPreset = signal<DatePreset>(DATE_PRESETS[1]);
  coinTitle = signal<string>('—');

  readonly coinSnapshot = this.hlCache.coinSnapshot;

  readonly presets = DATE_PRESETS;
  readonly intervals = CANDLE_INTERVALS;
  readonly intervalLabels = INTERVAL_LABELS;

  fetchFn = signal<() => Promise<void>>(async () => {});

  private readonly onMouseUp = () => this.scheduleOverlayDraw();
  private readonly onTouchEnd = () => this.scheduleOverlayDraw();

  private appReady = false;

  // ── Chart internals ────────────────────────────────────────────────────────
  private chart?: IChartApi;
  private candleSeries?: ISeriesApi<'Candlestick'>;
  private volumeSeries?: ISeriesApi<'Histogram'>;
  private resizeObserver?: ResizeObserver;
  private lastCandles: CandleSnapshot[] = [];
  private displayRangeStart = 0;

  // ── Indicators ────────────────────────────────────────────────────────
  activeIndicators = signal<ActiveIndicator[]>([]);
  /** Références vers la bibliothèque, jamais des copies — voir `StrategyRef`. */
  strategyRefs = signal<StrategyRef[]>([]);

  /** Résultats du dernier backtest, par id de stratégie. */
  private readonly strategyResults = signal<Map<string, StrategyRunResult>>(new Map());

  /**
   * Le bilan chiffré s'ouvre à la demande. Le panneau de positions montre déjà
   * l'essentiel en un coup d'œil ; garder quatre chiffres par stratégie
   * affichés en permanence coûterait de la hauteur sur un écran de téléphone.
   */
  readonly showBacktest = signal(false);

  /**
   * Ce que le chart et le bandeau affichent : les stratégies visibles dont un
   * résultat est connu. Une référence orpheline (stratégie supprimée de la
   * bibliothèque) n'y figure pas, mais reste listée dans les chips pour que
   * l'utilisateur puisse la détacher.
   */
  readonly visibleStrategyResults = computed(() => {
    const results = this.strategyResults();
    return this.strategyRefs()
      .filter((ref) => ref.visible)
      .map((ref) => results.get(ref.strategyId))
      .filter((result) => result !== undefined);
  });
  indicatorsMeta = signal<IndicatorMetadata[]>([]);
  private indicatorSeriesCache = new Map<string, { time: number; value: number }[]>();

  // ── Expressions ────────────────────────────────────────────────────────────

  /**
   * Expressions attachées. Ce sont des opérandes de règles, pas des courbes
   * libres : la liste de ce qu'on peut tracer se déduit des stratégies
   * attachées, et une expression dont la stratégie a été détachée disparaît
   * d'elle-même de `availableExpressions`.
   *
   * Même patron que les indicateurs et les stratégies : la requête porte tout
   * ce qui est attaché, la visibilité ne fait que filtrer l'affichage — ce qui
   * rend le basculement instantané.
   */
  readonly expressionRefs = signal<ExpressionRef[]>([]);
  private readonly expressionSeriesCache = signal<Map<string, ExpressionSeries>>(new Map());

  /** Dernier motif annoncé, et le toast qui le porte — voir `notifyOverlaysUnavailable`. */
  private announcedFailure: string | null = null;
  private failureToast: HTMLIonToastElement | null = null;

  /**
   * Ce que le catalogue du bot sait dire de l'échelle d'un opérande — servi par
   * `/exchanges/meta`, jamais dérivé d'un registre compilé.
   */
  private readonly scaleCatalogue = computed<ScaleCatalogue>(() => {
    const indicators = this.botService.indicators();
    const transforms = this.botService.transforms();

    return {
      indicatorOverlay: (name) => indicators.find((meta) => meta.name === name)?.overlay,
      transformOutputScale: (kind) => transforms.find((meta) => meta.kind === kind)?.outputScale,
    };
  });

  /**
   * Tout ce que les stratégies attachées comparent, dédupliqué.
   *
   * Le même `EMA(9)` employé par deux stratégies est une seule courbe : c'est
   * la même série, la tracer deux fois n'apprendrait rien et doublerait le
   * calcul demandé au bot.
   */
  private readonly collectedExpressions = computed(() => {
    const catalogue = this.scaleCatalogue();
    const collected = new Map<string, StrategyExpression & { sources: string[] }>();

    for (const ref of this.strategyRefs()) {
      const document = this.strategyLibrary.getById(ref.strategyId);
      if (!document) continue;

      for (const expression of collectStrategyOperands(document.rules, catalogue)) {
        const source = `${document.name} · ${expression.branches.join(', ')}`;
        const existing = collected.get(expression.id);

        if (existing) {
          if (!existing.sources.includes(source)) existing.sources.push(source);
          continue;
        }

        collected.set(expression.id, { ...expression, sources: [source] });
      }
    }

    return [...collected.values()];
  });

  /** Les mêmes, mises en forme pour le sélecteur et les puces. */
  readonly availableExpressions = computed<ExpressionRow[]>(() =>
    this.collectedExpressions().map((expression) => ({
      id: expression.id,
      label: formatOperand(expression.operand),
      detail: expression.sources.join(' — '),
      placement: isPriceScale(expression.scale) ? 'On the price chart' : 'Own pane',
      sound: expression.sound,
      color: strategyColor(expression.id),
    })),
  );

  /**
   * Opérandes à demander au bot : tout ce qui est attaché, visible ou non.
   *
   * Les opérandes malformés sont écartés. `POST /analysis` valide
   * `expressions[]` en bloc et rejette **toute la requête** si l'un d'eux est
   * incohérent — mesuré : une expression fautive faisait disparaître les
   * indicateurs du chart, qui n'y étaient pour rien. Ils restent listés et
   * marqués dans le sélecteur, jamais escamotés.
   */
  private attachedExpressions() {
    const attached = new Set(this.expressionRefs().map((ref) => ref.id));
    return this.collectedExpressions().filter(
      (expression) => attached.has(expression.id) && expression.sound,
    );
  }

  // ── Overlay internals ──────────────────────────────────────────────────────
  private overlayCtx?: CanvasRenderingContext2D;
  private animFrame?: number;
  private priceLines: IPriceLine[] = [];

  // ── Colors ─────────────────────────────────────────────────────────────────
  private readonly COLOR_BUY = '#2dd36f';
  private readonly COLOR_SELL = '#eb445a';
  private readonly COLOR_TPSL = '#f4a261';

  constructor() {
    addIcons({
      calendarOutline,
      refreshOutline,
      receiptOutline,
      addOutline,
      closeCircle,
      createOutline,
      statsChartOutline,
      chevronUpOutline,
      alertCircleOutline,
    });

    const state = window.history.state as { backHref?: string };
    if (state?.backHref) this.backHref.set(state.backHref);

    // Construit le chart dès que l'élément DOM est disponible
    effect(() => {
      const el = this.chartEl()?.nativeElement;
      if (!el || this.chart) return;
      untracked(() => this.buildChart(el));
    });

    // Recharge les candles au retour en foreground
    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => {
        if (!this.appReady) return;
        this.fetchFn.set(this.buildFetchFn());
      });
    });

    // Redessine l'overlay quand le snapshot change (nouvel ordre, fill exécuté…)
    effect(() => {
      this.hlCache.coinSnapshot();
      untracked(() => this.scheduleOverlayDraw());
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    const coin = this.route.snapshot.paramMap.get('coin');
    if (!coin) {
      this.router.navigate(['/secure/watchlist']);
      return;
    }

    const rawInterval =
      this.route.snapshot.paramMap.get('interval') ||
      this.route.snapshot.queryParamMap.get('interval');
    const interval: CandleInterval = CANDLE_INTERVALS.includes(rawInterval as CandleInterval)
      ? (rawInterval as CandleInterval)
      : '1h';

    this.item.set({ coin, interval, addedAt: Date.now() });
    this.selectedInterval.set(interval);

    await this.watchlistService.load();
    const existing = this.watchlistService.getByCoin(coin);
    if (existing) {
      this.item.set(existing);
      this.selectedInterval.set(existing.interval);
      this.activeIndicators.set(existing.activeIndicators ?? []);
      this.strategyRefs.set(existing.strategyRefs ?? []);
      this.expressionRefs.set(existing.expressionRefs ?? []);
    }

    // Les références ci-dessus ne veulent rien dire tant que la bibliothèque
    // n'est pas chargée : c'est elle qui porte les règles à backtester.
    await this.strategyLibrary.load();

    this.hlCache.selectCoinWithConfig(coin, { fillsLookbackDays: this.selectedPreset().days });
    this.hlCache.reloadAll();

    this.fetchFn.set(this.buildFetchFn());
    this.appReady = true;

    this.hlMarket.resolveCoin(coin).subscribe((name) => this.coinTitle.set(name));
  }

  ngOnDestroy(): void {
    const el = this.chartEl()?.nativeElement;
    if (el) {
      el.removeEventListener('mouseup', this.onMouseUp);
      el.removeEventListener('touchend', this.onTouchEnd);
    }
    this.resizeObserver?.disconnect();
    this.chart?.remove();
    this.clearOverlay();
    this.indicatorOverlay.reset();
    this.strategySignals.reset();
    // Après `chart.remove()` : `reset` oublie les séries sans chercher à les
    // retirer d'un chart qui n'existe plus.
    this.strategyPositions.reset();
    this.expressionsPane.reset();
    void this.dismissFailureToast();
    this.indicatorSeriesCache.clear();
    this.expressionSeriesCache.set(new Map());
    this.lastCandles = [];
    cancelAnimationFrame(this.animFrame!);
  }

  // ── Fetch candles ──────────────────────────────────────────────────────────

  private buildFetchFn() {
    return async () => {
      const item = this.item();
      if (!item) return;

      this.loading.set(true);
      this.hasError.set(false);

      const preset = this.selectedPreset();
      const endTime = Date.now();
      const startTime = endTime - preset.days * 86_400_000;
      const hasOverlayData =
        this.activeIndicators().some((i) => i.visible) ||
        this.strategyRefs().some((r) => r.visible) ||
        this.expressionRefs().length > 0;

      try {
        if (hasOverlayData) {
          await this.fetchViaAnalysis(item, startTime, endTime);
        } else {
          await this.fetchViaCandles(item, startTime, endTime);
        }
      } catch {
        this.hasError.set(true);
      } finally {
        this.loading.set(false);
      }
    };
  }

  private async fetchViaAnalysis(
    item: WatchlistItem,
    displayStartTime: number,
    endTime: number,
  ): Promise<void> {
    const active = this.activeIndicators();
    // Une stratégie sans côté à évaluer fait rejeter la requête d'analyse
    // ENTIÈRE (`collectExecutableStrategyRulesIssues` côté serveur), donc
    // emporterait aussi les indicateurs. On ne joint que celles qui passent la
    // validation locale ; les autres restent attachées, simplement pas envoyées.
    const strategies = this.attachedStrategies()
      .filter((document) => isLocallyExecutable(document.rules))
      .map(toAnalysisRequest);
    const expressions = this.attachedExpressions();

    const request: AnalysisRequest = {
      symbol: item.coin,
      interval: toChartInterval(this.selectedInterval()),
      // Début de la fenêtre à AFFICHER, jamais une valeur pré-paddée : le
      // serveur recule lui-même `startTime` du warm-up nécessaire
      // (`AnalysisService.padStartTimeForWarmup`), en s'appuyant sur un registre
      // de périodes qui peut évoluer sans ce build. Le client qui recalculait sa
      // propre marge ici ajoutait la sienne par-dessus.
      startTime: displayStartTime,
      endTime,
      indicators: active.map((i) => i.request),
      strategies: strategies.length > 0 ? strategies : undefined,
      // `id` explicite, jamais dérivé côté serveur : voir l'en-tête de
      // strategy-operands.util.ts. La clé de réponse est celle qu'on a choisie,
      // donc retrouvable quoi qu'il advienne des défauts du catalogue.
      expressions:
        expressions.length > 0
          ? expressions.map(({ id, operand }) => ({ id, operand }))
          : undefined,
    };

    try {
      const res = await firstValueFrom(this.chartAnalysis.analyze(request));
      if (!res.candles.length) {
        this.hasError.set(true);
        return;
      }

      // Les surcouches sont revenues : le prochain échec, même identique, aura
      // de nouveau le droit de se faire entendre.
      this.announcedFailure = null;

      const candles = this.toCandleSnapshots(res.candles);
      this.lastCandles = candles;
      this.displayRangeStart = displayStartTime;

      this.renderCandles(candles);
      this.computeStats(candles.filter((c) => c.t >= displayStartTime));
      this.cacheIndicatorSeries(res, active);
      this.applyIndicatorVisibility();
      this.cacheStrategyResults(res);
      this.applyStrategyVisibility();
      this.cacheExpressionSeries(res);
      this.applyExpressionVisibility();
      this.scheduleOverlayDraw();

      this.chart?.timeScale().setVisibleRange({
        from: Math.floor(displayStartTime / 1000) as Time,
        to: Math.floor(endTime / 1000) as Time,
      });
    } catch (error) {
      // Repli ANNONCÉ. Le chart reste utilisable en bougies nues, mais les
      // indicateurs et les signaux disparaissaient jusqu'ici sans un mot : une
      // panne du service d'analyse se lisait comme « cet indicateur ne donne
      // rien », ce qui est le pire diagnostic possible sur un outil de trading.
      await this.fetchViaCandles(item, displayStartTime, endTime);
      await this.notifyOverlaysUnavailable(error);
    }
  }

  /**
   * Dit pourquoi le chart est nu, et ne se trompe pas de coupable.
   *
   * Un refus du bot n'est pas une panne : il répond, et il explique. Annoncer
   * « the analysis service did not respond » sur un `400` envoyait chercher du
   * côté du réseau un problème qui était dans la requête — exactement le genre
   * de diagnostic faux qu'on ne veut pas sur un outil de trading.
   */
  private async notifyOverlaysUnavailable(error: unknown): Promise<void> {
    const reason = overlayFailureReason(error);

    // Le même motif ne se réannonce pas. Un refus du bot est un **état** — il
    // reste vrai tant que la configuration ne change pas — alors qu'un toast
    // est fait pour un événement. Sans ce garde-fou, chaque rechargement (un
    // changement d'intervalle, un retour au premier plan) en empilait un de
    // plus : trois toasts de 6 s présentés à la suite se lisent comme un seul
    // qui ne part jamais, et finissent par masquer l'app.
    if (reason === this.announcedFailure) return;
    this.announcedFailure = reason;

    await this.dismissFailureToast();

    this.failureToast = await this.toastCtrl.create({
      message: `Chart loaded without indicators — ${reason}`,
      color: 'warning',
      duration: 6000,
    });
    await this.failureToast.present();
  }

  /**
   * Referme l'annonce en cours.
   *
   * Appelé aussi à la destruction : un toast survit à la page qui l'a créé, et
   * un message sur le chart de BTC n'a rien à faire par-dessus la watchlist.
   */
  private async dismissFailureToast(): Promise<void> {
    const toast = this.failureToast;
    this.failureToast = null;
    await toast?.dismiss();
  }

  private toCandleSnapshots(candles: AnalysisCandle[]): CandleSnapshot[] {
    return candles.map((c) => ({
      t: c.time,
      o: String(c.open),
      h: String(c.high),
      l: String(c.low),
      c: String(c.close),
      v: String(c.volume),
    })) as CandleSnapshot[];
  }

  /** Stocke les points bruts par id d'indicateur actif, sans les rendre — le rendu se fait via applyIndicatorVisibility(). */
  private cacheIndicatorSeries(res: AnalysisResponse, active: ActiveIndicator[]): void {
    this.indicatorSeriesCache = mapIndicatorSeriesById(
      res.indicators as unknown as Record<string, { time: number; value: number }[]>,
      active,
      (request) => this.botService.buildIndicatorKey(request),
    );
  }

  /**
   * Range les résultats de backtest par id de stratégie — la réponse porte
   * l'id de chacune, il n'y a donc rien à deviner sur son ordre.
   */
  private cacheStrategyResults(res: AnalysisResponse): void {
    this.strategyResults.set(
      new Map(
        res.strategies.map((result) => [
          result.id,
          {
            strategyId: result.id,
            name: result.name,
            color: strategyColor(result.id),
            signals: result.signals,
            summary: result.summary,
          },
        ]),
      ),
    );
  }

  /**
   * Rejoue le rendu depuis le cache — AUCUN appel réseau, comme
   * `applyIndicatorVisibility`. Masquer une stratégie n'a pas à relancer un
   * backtest : la requête demande tout ce qui est attaché, l'affichage ne
   * retient que ce qui est visible.
   */
  private applyStrategyVisibility(): void {
    const layers = this.visibleStrategyResults();

    if (layers.length === 0) {
      this.strategySignals.clear();
      this.strategyPositions.clear();
      return;
    }

    this.strategySignals.render(layers);
    // La bande a besoin des bougies : un segment de position sans elles ne
    // serait qu'un début et une fin, pas une durée à colorer.
    this.strategyPositions.render(
      layers,
      this.lastCandles.map((candle) => candle.t),
    );
  }

  /** Affiche/masque chaque indicateur actif depuis le cache — AUCUN appel réseau.
   *  Appelé après un fetch (pour le rendu initial) ET à chaque toggle de visibilité. */
  private applyIndicatorVisibility(): void {
    this.activeIndicators().forEach((active) => {
      if (!active.visible) {
        this.indicatorOverlay.remove(active.id);
        return;
      }

      const points = this.indicatorSeriesCache.get(active.id);
      if (!points) return;

      this.botService.getIndicatorMeta(active.request.name).subscribe((meta) => {
        if (!meta) return;
        // Re-vérifie la visibilité au retour (garde contre race condition toggle rapide)
        const stillVisible = this.activeIndicators().find((i) => i.id === active.id)?.visible;
        if (!stillVisible) return;
        this.indicatorOverlay.render(
          active.id,
          meta,
          points,
          active.color,
          active.subFieldStyles,
          active.hlines,
        );
      });
    });
  }

  private async fetchViaCandles(
    item: WatchlistItem,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    const candles = await firstValueFrom(
      this.hlCandle.getCandles({
        coin: item.coin,
        interval: this.selectedInterval(),
        startTime,
        endTime,
      }),
    );

    if (!candles.length) {
      this.hasError.set(true);
      return;
    }

    this.lastCandles = candles;
    this.displayRangeStart = startTime;
    this.renderCandles(candles);
    this.computeStats(candles);
    this.strategySignals.clear();
    this.expressionsPane.clear();
    this.indicatorSeriesCache.clear();
    this.expressionSeriesCache.set(new Map());
    this.activeIndicators().forEach((i) => this.indicatorOverlay.remove(i.id));
    this.scheduleOverlayDraw();
  }

  loadData(): void {
    this.fetchFn.set(this.buildFetchFn());
  }

  // ── Chart setup ────────────────────────────────────────────────────────────

  private buildChart(el: HTMLDivElement): void {
    const h = el.getBoundingClientRect().height || 400;

    this.chart = createChart(el, {
      width: el.clientWidth,
      height: h,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor:
          getComputedStyle(document.documentElement).getPropertyValue('--ion-text-color') || '#ccc',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(128,128,128,0.1)' },
        horzLines: { color: 'rgba(128,128,128,0.1)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });

    this.candleSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: this.COLOR_BUY,
      downColor: this.COLOR_SELL,
      borderVisible: false,
      wickUpColor: this.COLOR_BUY,
      wickDownColor: this.COLOR_SELL,
    });

    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      color: 'rgba(128,128,128,0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    this.indicatorOverlay.attach(this.chart);
    this.strategySignals.attach(this.candleSeries);
    this.strategyPositions.attach(this.chart);
    this.expressionsPane.attach(this.chart);

    this.chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Redessine l'overlay à chaque scroll / zoom
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      this.scheduleOverlayDraw();
    });

    this.subscribeChartEvents();

    // Initialise le canvas overlay
    const canvas = this.overlayEl()?.nativeElement;
    if (canvas) this.initOverlay(canvas, el);
  }

  // ── Candle rendering ───────────────────────────────────────────────────────

  private renderCandles(candles: CandleSnapshot[]): void {
    this.candleSeries?.setData(
      candles.map((c) => ({
        time: Math.floor(c.t / 1000) as any,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
      })),
    );

    this.volumeSeries?.setData(
      candles.map((c) => ({
        time: Math.floor(c.t / 1000) as any,
        value: parseFloat(c.v),
        color: parseFloat(c.c) >= parseFloat(c.o) ? 'rgba(45,211,111,0.4)' : 'rgba(235,68,90,0.4)',
      })),
    );

    this.chart?.timeScale().fitContent();

    requestAnimationFrame(() => {
      const el = this.chartEl()?.nativeElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) {
        this.chart?.applyOptions({ width: rect.width, height: rect.height });
        this.chart?.timeScale().fitContent();
      }
    });
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  private computeStats(candles: CandleSnapshot[]): void {
    const first = parseFloat(candles[0].o);
    const last = parseFloat(candles[candles.length - 1].c);
    const change = ((last - first) / first) * 100;
    const changeAbs = last - first;

    this.priceChange.set(change);
    this.priceChangeAbs.set(
      (changeAbs >= 0 ? '+' : '') +
        (Math.abs(changeAbs) < 1 ? changeAbs.toFixed(6) : changeAbs.toFixed(2)),
    );
    this.currentPrice.set(
      last < 1 ? last.toFixed(6) : last < 100 ? last.toFixed(4) : last.toFixed(2),
    );
  }

  // ── Canvas overlay ─────────────────────────────────────────────────────────

  private subscribeChartEvents(): void {
    this.chart!.timeScale().subscribeVisibleLogicalRangeChange(() => {
      this.scheduleOverlayDraw();
    });

    this.chart!.subscribeCrosshairMove(() => {
      this.scheduleOverlayDraw();
    });

    const el = this.chartEl()!.nativeElement;
    el.addEventListener('mouseup', this.onMouseUp);
    el.addEventListener('touchend', this.onTouchEnd);
  }

  private getIntervalSeconds(): number {
    const map: Record<CandleInterval, number> = {
      '1m': 60,
      '3m': 180,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '1h': 3600,
      '2h': 7200,
      '4h': 14400,
      '8h': 28800,
      '12h': 43200,
      '1d': 86400,
      '3d': 259200,
      '1w': 604800,
      '1M': 2592000,
    };
    return map[this.selectedInterval()] ?? 3600;
  }

  private initOverlay(canvas: HTMLCanvasElement, container: HTMLDivElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.overlayCtx = ctx;

    // Synchronise les dimensions du canvas avec le container
    this.resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height || 400;
      this.chart?.applyOptions({ width: rect.width, height: rect.height || 400 });
      this.drawOverlay();
    });
    this.resizeObserver.observe(container);
  }

  /** Planifie un redraw au prochain frame (évite les draws en doublon). */
  private scheduleOverlayDraw(): void {
    cancelAnimationFrame(this.animFrame!);
    this.animFrame = requestAnimationFrame(() => this.drawOverlay());
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    const snap = this.hlCache.coinSnapshot();

    if (!ctx || !this.candleSeries || !this.chart) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (!snap) return;

    this.drawOrderLines(ctx, snap.historicalOrders);
    this.drawFills(ctx, snap.fills);
  }

  private drawFills(ctx: CanvasRenderingContext2D, fills: HLUserFill[]): void {
    const intervalSec = this.getIntervalSeconds();

    for (const fill of fills) {
      const snappedTime = (Math.floor(fill.time / 1000 / intervalSec) *
        intervalSec) as unknown as Time;
      const x = this.chart!.timeScale().timeToCoordinate(snappedTime);
      const y = this.candleSeries!.priceToCoordinate(parseFloat(fill.px));

      if (x === null || y === null) continue;

      const isBuy = fill.side === 'B';
      const color = isBuy ? this.COLOR_BUY : this.COLOR_SELL;
      const radius = 4;

      // Point précis
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle = color;
      ctx.font = '10px monospace';
      ctx.fillText(`${isBuy ? '▲' : '▼'} ${parseFloat(fill.sz).toFixed(4)}`, x + radius + 3, y + 3);
    }
  }

  /** Supprime toutes les price lines natives (si utilisées ailleurs). */
  private clearOverlay(): void {
    this.priceLines.forEach((pl) => {
      try {
        this.candleSeries?.removePriceLine(pl);
      } catch {
        /* série déjà détruite */
      }
    });
    this.priceLines = [];
  }

  private isTerminal(status: string): boolean {
    return (
      status.includes('canceled') ||
      status === 'filled' ||
      status === 'triggered' ||
      status.includes('rejected')
    );
  }

  private drawOrderLines(ctx: CanvasRenderingContext2D, orders: HLOrderStatusData[]): void {
    const groups = new Map<string, HLOrderStatusData[]>();
    for (const entry of orders) {
      const o = entry.order;
      const key = `${o.oid}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    for (const chain of groups.values()) {
      chain.sort((a, b) => {
        if (a.statusTimestamp !== b.statusTimestamp) {
          return a.statusTimestamp - b.statusTimestamp;
        }
        // À timestamp égal (ex: ordre IOC rempli instantanément), l'état
        // terminal représente toujours l'état final réel : on le place
        // après l'état non-terminal ("open") pour ne pas le traiter
        // comme actif.
        const aTerminal = this.isTerminal(a.status.toLowerCase());
        const bTerminal = this.isTerminal(b.status.toLowerCase());
        return (aTerminal ? 1 : 0) - (bTerminal ? 1 : 0);
      });
      this.drawOrderChain(ctx, chain);
    }
  }

  private drawOrderChain(ctx: CanvasRenderingContext2D, chain: HLOrderStatusData[]): void {
    const visibleRange = this.chart!.timeScale().getVisibleRange();
    const intervalSec = this.getIntervalSeconds();

    if (!visibleRange) return;

    const visibleFromMs = (visibleRange.from as unknown as number) * 1000;
    const visibleToMs = (visibleRange.to as unknown as number) * 1000;

    const isTrigger = chain[0].order.isTrigger;
    const orderType = chain[0].order.orderType.toLowerCase();
    const isTP = orderType.includes('take profit');
    const isSL = orderType.includes('stop');

    let color: string;
    if (isTrigger) {
      // TP toujours vert, SL toujours rouge
      color = isTP ? this.COLOR_BUY : this.COLOR_SELL;
    } else {
      // Limit : couleur selon le side
      color = chain[0].order.side === 'B' ? this.COLOR_BUY : this.COLOR_SELL;
    }
    const dash = isTrigger ? [5, 4] : [];

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      const order = entry.order;
      const status = entry.status.toLowerCase();

      if (this.isTerminal(status)) continue;

      const price = parseFloat(isTrigger ? order.triggerPx : order.limitPx);
      if (!price) continue;

      const nextTerminal = chain.find(
        (e, idx) => idx > i && this.isTerminal(e.status.toLowerCase()),
      );

      const endTs = nextTerminal ? nextTerminal.statusTimestamp : visibleToMs;
      const isActive = !nextTerminal;

      if (!isActive && (endTs < visibleFromMs || entry.statusTimestamp > visibleToMs)) continue;

      const y = this.candleSeries!.priceToCoordinate(price);
      if (y === null) continue;

      const snappedStart = (Math.round(entry.statusTimestamp / 1000 / intervalSec) *
        intervalSec) as unknown as Time;
      const xStartRaw = this.chart!.timeScale().timeToCoordinate(snappedStart);
      const xLeftEdge = this.chart!.timeScale().timeToCoordinate(visibleRange.from) ?? 0;
      const xStart = xStartRaw !== null && xStartRaw > xLeftEdge ? xStartRaw : xLeftEdge;

      const snappedEnd = nextTerminal
        ? ((Math.round(nextTerminal.statusTimestamp / 1000 / intervalSec) *
            intervalSec) as unknown as Time)
        : visibleRange.to;
      let xEnd = this.chart!.timeScale().timeToCoordinate(snappedEnd);
      if (xEnd === null) continue;

      // ── Segment horizontal ────────────────────────────────────────────────
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.moveTo(xStart, y);
      ctx.lineTo(xEnd, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = isActive ? 1.5 : 1;
      ctx.globalAlpha = isActive ? 1 : 0.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // ── Label bord droit si segment actif ────────────────────────────────
      if (isActive) {
        const priceLabel = isTrigger ? order.triggerPx : order.limitPx;

        const fSize = 10;
        ctx.font = `${fSize}px monospace`;
        const tw = ctx.measureText(priceLabel).width;
        const padX = 6,
          padY = 4;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(xEnd, y - fSize / 2 - padY, tw + padX * 2, fSize + padY * 2, 3);
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.fillText(priceLabel, xEnd + padX, y + fSize / 2 - 2);
      }
    }
  }

  // ── UI handlers ────────────────────────────────────────────────────────────

  onPresetChange(preset: DatePreset): void {
    this.selectedPreset.set(preset);
    this.selectedInterval.set(preset.interval);
    this.hlCache.updateConfig({ fillsLookbackDays: preset.days });
    this.loadData();
  }

  onIntervalChange(interval: CandleInterval): void {
    this.selectedInterval.set(interval);
    this.hlCache.updateConfig({ fillsLookbackDays: this.selectedPreset().days });
    this.loadData();
  }

  get changeSign(): string {
    return this.priceChange() >= 0 ? '+' : '';
  }

  navigateToOpenOrders(): void {
    this.router.navigate(['/secure/open-orders'], {
      queryParams: { coin: this.item()?.coin },
    });
  }

  // ── Indicators ────────────────────────────────────────────────────────────

  async openIndicatorPicker(existing?: ActiveIndicator): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: IndicatorPickerComponent,
      componentProps: {
        editingIndicator: () => existing,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    if (role === 'confirm' && data) {
      const updated = data as ActiveIndicator;
      this.activeIndicators.update((list) => {
        const idx = list.findIndex((i) => i.id === updated.id);
        if (idx === -1) return [...list, updated];
        const next = [...list];
        next[idx] = updated;
        return next;
      });
      this.persistIndicators();
      this.loadData();
    }
  }

  editIndicator(indicator: ActiveIndicator): void {
    this.openIndicatorPicker(indicator);
  }

  toggleIndicatorVisibility(id: string): void {
    this.activeIndicators.update((list) =>
      list.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
    );
    this.applyIndicatorVisibility();
    this.persistIndicators();
  }

  removeIndicator(id: string): void {
    this.indicatorOverlay.remove(id);
    this.indicatorSeriesCache.delete(id);
    this.activeIndicators.update((list) => list.filter((i) => i.id !== id));
    this.persistIndicators();
  }

  indicatorLabel(active: ActiveIndicator): string {
    return formatIndicatorLabel(active.request);
  }

  dotColor(active: ActiveIndicator): string {
    const styles = active.subFieldStyles;
    if (!styles) return active.color || '#888';

    const name = active.request.name;
    const canonicalOrder = this.botService.getIndicatorSubFieldNames(name);

    // Le point du chip ne peut représenter qu'une seule couleur : on prend la
    // première ligne VISIBLE dans l'ordre canonique renvoyé par le bot
    // (IndicatorMetadata.subFields), pas l'ordre — non garanti — des clés de l'objet.
    const preferred =
      canonicalOrder.find((field) => styles[field]?.visible !== false) ??
      canonicalOrder.find((field) => styles[field]) ??
      Object.keys(styles)[0];

    return (preferred ? styles[preferred]?.color : undefined) ?? '#888';
  }

  private persistIndicators(): void {
    const item = this.item();
    if (!item || !this.watchlistService.getByCoin(item.coin)) return;
    this.watchlistService.update(item.coin, {
      activeIndicators: this.activeIndicators(),
      strategyRefs: this.strategyRefs(),
      expressionRefs: this.expressionRefs(),
    });
  }

  /**
   * Documents désignés par TOUTES les références attachées, visibles ou non.
   *
   * L'analyse demande tout ce qui est attaché — même patron que les
   * indicateurs, où la requête porte la liste active et l'affichage filtre
   * ensuite. Basculer la visibilité redevient ainsi instantané.
   */
  private attachedStrategies() {
    return this.strategyRefs()
      .map((ref) => this.strategyLibrary.getById(ref.strategyId))
      .filter((document) => document !== undefined);
  }

  strategyName(strategyId: string): string {
    return this.strategyLibrary.getById(strategyId)?.name ?? 'Unavailable';
  }

  strategyColorOf(strategyId: string): string {
    return strategyColor(strategyId);
  }

  async openStrategyPicker(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: StrategyPickerModalComponent,
      componentProps: { attachedIds: () => this.strategyRefs().map((ref) => ref.strategyId) },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string[]>();
    if (role !== 'confirm' || !data) return;

    // Les références déjà présentes gardent leur visibilité ; les nouvelles
    // arrivent visibles, sans quoi les attacher n'aurait aucun effet visible.
    const previous = new Map(this.strategyRefs().map((ref) => [ref.strategyId, ref]));
    this.strategyRefs.set(
      data.map((strategyId) => previous.get(strategyId) ?? { strategyId, visible: true }),
    );

    this.persistIndicators();
    this.loadData();
  }

  toggleStrategyVisibility(strategyId: string): void {
    this.strategyRefs.update((refs) =>
      refs.map((ref) => (ref.strategyId === strategyId ? { ...ref, visible: !ref.visible } : ref)),
    );
    this.persistIndicators();

    // Une stratégie rendue visible alors qu'elle n'a pas de résultat en cache
    // n'a jamais été backtestée sur cette fenêtre : là seulement, il faut
    // refaire l'appel.
    const missing = this.strategyRefs().some(
      (ref) => ref.visible && !this.strategyResults().has(ref.strategyId),
    );

    if (missing) this.loadData();
    else this.applyStrategyVisibility();
  }

  detachStrategy(strategyId: string): void {
    this.strategyRefs.update((refs) => refs.filter((ref) => ref.strategyId !== strategyId));
    this.persistIndicators();
    this.applyStrategyVisibility();
  }

  // ── Expressions ────────────────────────────────────────────────────────────

  /** Chips affichées : les expressions attachées, dans l'ordre où elles sont proposées. */
  readonly selectedExpressionRows = computed(() =>
    this.availableExpressions().filter((row) =>
      this.expressionRefs().some((ref) => ref.id === row.id),
    ),
  );

  isExpressionVisible(id: string): boolean {
    return this.expressionRefs().find((ref) => ref.id === id)?.visible ?? false;
  }

  /** Masquer ou réafficher une expression déjà demandée — aucun appel réseau. */
  toggleExpressionVisibility(id: string): void {
    this.expressionRefs.update((refs) =>
      refs.map((ref) => (ref.id === id ? { ...ref, visible: !ref.visible } : ref)),
    );
    this.persistIndicators();
    this.applyExpressionVisibility();
  }

  /**
   * Trous survenus après le démarrage de la série — l'amorçage d'une fenêtre
   * glissante n'en fait pas partie (expression-series.util.ts).
   *
   * Affiché parce qu'un trou n'est pas un détail de tracé : une condition qui
   * ne se déclenche jamais peut n'avoir que ce symptôme-là — un z-score sur une
   * fenêtre d'écart-type nul ne vaut rien, donc ne dépasse aucun seuil.
   */
  indeterminateCount(id: string): number {
    return this.expressionSeriesCache().get(id)?.indeterminate ?? 0;
  }

  async openExpressionPicker(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ExpressionPickerModalComponent,
      componentProps: {
        rows: () => this.availableExpressions(),
        selectedIds: () => this.expressionRefs().map((ref) => ref.id),
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<string[]>();
    if (role !== 'confirm' || !data) return;

    // Les expressions déjà attachées gardent leur visibilité ; les nouvelles
    // arrivent visibles, sans quoi les cocher n'aurait aucun effet visible.
    const previous = new Map(this.expressionRefs().map((ref) => [ref.id, ref]));
    const added = data.some((id) => !previous.has(id));

    this.expressionRefs.set(data.map((id) => previous.get(id) ?? { id, visible: true }));
    this.persistIndicators();

    // Une expression nouvellement cochée n'a pas de série : elle n'a jamais été
    // demandée au bot sur cette fenêtre. Retirer, en revanche, se règle sur
    // place — même raisonnement que pour la visibilité d'une stratégie.
    if (added) this.loadData();
    else this.applyExpressionVisibility();
  }

  removeExpression(id: string): void {
    this.expressionRefs.update((refs) => refs.filter((ref) => ref.id !== id));
    this.persistIndicators();
    this.applyExpressionVisibility();
  }

  /** Range les séries d'expressions telles quelles, sans les rendre. */
  private cacheExpressionSeries(res: AnalysisResponse): void {
    const cache = new Map<string, ExpressionSeries>();

    for (const [id, points] of Object.entries(res.expressions ?? {})) {
      cache.set(id, toExpressionSeries(points as unknown as RawExpressionPoint[]));
    }

    this.expressionSeriesCache.set(cache);
  }

  /**
   * Dessine les expressions visibles depuis le cache — AUCUN appel réseau.
   *
   * Le groupe décide de l'endroit : les niveaux de prix rejoignent les bougies,
   * le reste obtient un panneau par échelle (`operand-scale.util.ts`).
   */
  private applyExpressionVisibility(): void {
    const collected = new Map(this.collectedExpressions().map((e) => [e.id, e]));
    const rows = new Map(this.availableExpressions().map((row) => [row.id, row]));
    const cache = this.expressionSeriesCache();

    const layers = this.expressionRefs()
      .filter((ref) => ref.visible)
      .map((ref): ExpressionLayer | undefined => {
        const expression = collected.get(ref.id);
        const row = rows.get(ref.id);
        const series = cache.get(ref.id);
        if (!expression || !row || !series) return undefined;

        return {
          id: ref.id,
          label: row.label,
          color: row.color,
          group: isPriceScale(expression.scale) ? PRICE_GROUP : scaleGroupOf(expression.scale),
          series,
        };
      })
      .filter((layer) => layer !== undefined);

    this.expressionsPane.render(layers);
  }
}
