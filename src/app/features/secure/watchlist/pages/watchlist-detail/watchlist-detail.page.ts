import {
  ChangeDetectionStrategy,
  Component,
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
  AnalysisStrategyRequest,
  IndicatorMetadata,
} from '@syldel/trading-shared-types';
import { toChartInterval } from '@utils/hl-interval.utils';
import { addIcons } from 'ionicons';
import {
  addOutline,
  calendarOutline,
  closeCircle,
  createOutline,
  receiptOutline,
  refreshOutline,
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

import { computeLookbackCandles } from '@shared/components/indicator-picker/models/indicator-lookback.util';
import { IndicatorOverlayService } from '@shared/components/indicator-picker/services/indicator-overlay.service';
import { formatIndicatorLabel } from '@shared/components/indicator-picker/utils/indicator-label.util';
import {
  DATE_PRESETS,
  DatePreset,
  INTERVAL_LABELS,
  WatchlistItem,
} from '../../models/watchlist-item.model';
import { StrategySignalsOverlayService } from '../../services/strategy-signals-overlay.service';
import { WatchlistService } from '../../services/watchlist.service';

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
  providers: [IndicatorOverlayService, StrategySignalsOverlayService],
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
  private readonly modalCtrl = inject(ModalController);
  private readonly watchlistService = inject(WatchlistService);

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
  activeStrategy = signal<AnalysisStrategyRequest | null>(null);
  indicatorsMeta = signal<IndicatorMetadata[]>([]);
  private indicatorSeriesCache = new Map<string, { time: number; value: number }[]>();

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
      this.activeStrategy.set(existing.activeStrategy ?? null);
    }

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
    this.indicatorSeriesCache.clear();
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
        this.activeIndicators().some((i) => i.visible) || !!this.activeStrategy();

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
    const strategy = this.activeStrategy();

    const intervalMs = this.getIntervalSeconds() * 1000;
    const lookbackCandles = computeLookbackCandles(active);
    const fetchStartTime = displayStartTime - lookbackCandles * intervalMs;

    const request: AnalysisRequest = {
      symbol: item.coin,
      interval: toChartInterval(this.selectedInterval()),
      startTime: fetchStartTime,
      endTime,
      indicators: active.map((i) => i.request),
      strategies: strategy ? [strategy] : undefined,
    };

    try {
      const res = await firstValueFrom(this.chartAnalysis.analyze(request));
      if (!res.candles.length) {
        this.hasError.set(true);
        return;
      }

      const candles = this.toCandleSnapshots(res.candles);
      this.lastCandles = candles;
      this.displayRangeStart = displayStartTime;

      this.renderCandles(candles);
      this.computeStats(candles.filter((c) => c.t >= displayStartTime));
      this.cacheIndicatorSeries(res, active);
      this.applyIndicatorVisibility();
      this.applyStrategySignals(res);
      this.scheduleOverlayDraw();

      this.chart?.timeScale().setVisibleRange({
        from: Math.floor(displayStartTime / 1000) as Time,
        to: Math.floor(endTime / 1000) as Time,
      });
    } catch {
      await this.fetchViaCandles(item, displayStartTime, endTime);
    }
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
    const seriesList = Object.values(res.indicators);
    this.indicatorSeriesCache.clear();
    active.forEach((ind, idx) => {
      const points = seriesList[idx];
      if (points)
        this.indicatorSeriesCache.set(ind.id, points as { time: number; value: number }[]);
    });
  }

  private applyStrategySignals(res: AnalysisResponse): void {
    if (res.strategies.length > 0) {
      this.strategySignals.render(res.strategies[0].signals);
    } else {
      this.strategySignals.clear();
    }
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
        this.indicatorOverlay.render(active.id, meta, points, active.color, active.subFieldStyles);
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
    this.indicatorSeriesCache.clear();
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
      breakpoints: [0, 0.6, 1],
      initialBreakpoint: 0.6,
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
    if (active.subFieldStyles) {
      const first = Object.values(active.subFieldStyles)[0];
      return first?.color ?? '#888';
    }
    return active.color || '#888';
  }

  private persistIndicators(): void {
    const item = this.item();
    if (!item || !this.watchlistService.getByCoin(item.coin)) return;
    this.watchlistService.update(item.coin, {
      activeIndicators: this.activeIndicators(),
      activeStrategy: this.activeStrategy(),
    });
  }
}
