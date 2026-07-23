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
import { IonButton, IonChip, IonIcon, IonSkeletonText } from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { BotService } from '@services/bot.service';
import { ChartAnalysisService } from '@services/chart-analysis.service';
import { HyperliquidCacheService } from '@services/hyperliquid-cache.service';
import { HyperliquidCandleService } from '@services/hyperliquid-candle.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import {
  CANDLE_INTERVALS,
  CandleInterval,
  CandleSnapshot,
  HLOrderStatusData,
  HLUserFill,
} from '@syldel/hl-shared-types';
import {
  AnalysisRequest,
  AnalysisStrategyRequest,
  IndicatorRequest,
} from '@syldel/trading-shared-types';
import { toChartInterval } from '@utils/hl-interval.utils';
import { addIcons } from 'ionicons';
import { calendarOutline, receiptOutline, refreshOutline } from 'ionicons/icons';
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
import {
  ActiveIndicator,
  DATE_PRESETS,
  DatePreset,
  INTERVAL_LABELS,
  WatchlistItem,
} from '../../models/watchlist-item.model';
import { IndicatorOverlayService } from '../../services/indicator-overlay.service';
import { StrategySignalsOverlayService } from '../../services/strategy-signals-overlay.service';

@Component({
  selector: 'app-watchlist-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IonButton, IonSkeletonText, IonIcon, IonChip, RefreshableLayoutComponent],
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

  fetchFn = signal(this.buildFetchFn());

  private readonly onMouseUp = () => this.scheduleOverlayDraw();
  private readonly onTouchEnd = () => this.scheduleOverlayDraw();

  // ── Chart internals ────────────────────────────────────────────────────────
  private chart?: IChartApi;
  private candleSeries?: ISeriesApi<'Candlestick'>;
  private volumeSeries?: ISeriesApi<'Histogram'>;
  private resizeObserver?: ResizeObserver;

  activeIndicators = signal<ActiveIndicator[]>([]);
  activeStrategy = signal<AnalysisStrategyRequest | null>(null);
  private lastCandles: CandleSnapshot[] | null = null;

  // ── Overlay internals ──────────────────────────────────────────────────────
  private overlayCtx?: CanvasRenderingContext2D;
  private animFrame?: number;
  private priceLines: IPriceLine[] = [];

  // ── Colors ─────────────────────────────────────────────────────────────────
  private readonly COLOR_BUY = '#2dd36f';
  private readonly COLOR_SELL = '#eb445a';
  private readonly COLOR_TPSL = '#f4a261';

  constructor() {
    addIcons({ calendarOutline, refreshOutline, receiptOutline });

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
      untracked(() => this.fetchFn.set(this.buildFetchFn()));
    });

    // Redessine l'overlay quand le snapshot change (nouvel ordre, fill exécuté…)
    effect(() => {
      this.hlCache.coinSnapshot();
      untracked(() => this.scheduleOverlayDraw());
    });

    // Recalcule les overlays quand les indicateurs/stratégie actifs changent,
    // sans re-fetcher les candles (déjà en mémoire, pas besoin de loadData()).
    effect(() => {
      this.activeIndicators();
      this.activeStrategy();
      untracked(() => {
        const candles = this.lastCandles;
        if (candles) this.refreshAnalysisOverlays(candles);
      });
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
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

    // Déclare le coin actif dans le cache et déclenche le chargement
    this.hlCache.selectCoin(coin);
    this.hlCache.updateConfig({ fillsLookbackDays: this.selectedPreset().days });
    this.hlCache.reloadAll();

    this.fetchFn.set(this.buildFetchFn());

    this.hlMarket.resolveCoin(coin).subscribe((name) => this.coinTitle.set(name));
  }

  ngOnDestroy(): void {
    const el = this.chartEl()?.nativeElement;
    if (el) {
      el.removeEventListener('mouseup', this.onMouseUp);
      el.removeEventListener('touchend', this.onTouchEnd);
    }
    this.resizeObserver?.disconnect();
    this.clearOverlay();
    this.lastCandles = null;
    this.strategySignals.reset();
    this.indicatorOverlay.reset();
    this.chart?.remove();
    cancelAnimationFrame(this.animFrame!);
  }

  // ── Fetch candles ──────────────────────────────────────────────────────────

  private buildFetchFn() {
    return async () => {
      const item = this.item();
      if (!item) return;

      this.loading.set(true);
      this.hasError.set(false);

      try {
        const preset = this.selectedPreset();
        const endTime = Date.now();
        const startTime = endTime - preset.days * 86_400_000;

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
        this.renderCandles(candles);
        this.computeStats(candles);
        this.refreshAnalysisOverlays(candles);

        // Overlay dessiné après rendu des candles
        this.scheduleOverlayDraw();
      } catch {
        this.hasError.set(true);
      } finally {
        this.loading.set(false);
      }
    };
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

  private refreshAnalysisOverlays(candles: CandleSnapshot[]): void {
    const indicators = this.activeIndicators().filter((i) => i.visible);
    const strategy = this.activeStrategy();

    // Rien d'actif → on nettoie et on économise un appel réseau
    if (indicators.length === 0 && !strategy) {
      this.strategySignals.clear();
      this.activeIndicators().forEach((i) => this.indicatorOverlay.remove(i.id));
      return;
    }

    const item = this.item();
    if (!item || candles.length === 0) return;

    const request: AnalysisRequest = {
      symbol: item.coin,
      interval: toChartInterval(this.selectedInterval()),
      startTime: Math.floor(candles[0].t),
      endTime: Math.floor(candles[candles.length - 1].t),
      indicators: indicators.map((i) => i.request),
      strategies: strategy ? [strategy] : undefined,
    };

    this.chartAnalysis.analyze(request).subscribe({
      next: (res) => {
        indicators.forEach((active) => {
          const key = this.buildIndicatorKey(active.request); // ex: "ema_20", "macd_12_26_9"
          const points = res.indicators[key];
          if (!points) return;

          this.botService.getIndicatorMeta(active.request.name).subscribe((meta) => {
            if (!meta) return;
            this.indicatorOverlay.render(
              active.id,
              meta,
              points as { time: number; value: number }[],
            );
          });
        });

        // Signaux de stratégie
        if (res.strategies.length > 0) {
          this.strategySignals.render(res.strategies[0].signals);
        } else {
          this.strategySignals.clear();
        }
      },
      error: () => {
        // Ne bloque pas l'affichage des candles si /analysis échoue — juste pas d'overlay
      },
    });
  }

  private buildIndicatorKey(req: IndicatorRequest): string {
    switch (req.name) {
      case 'macd':
        return `macd_${req.fastPeriod ?? 12}_${req.slowPeriod ?? 26}_${req.signalPeriod ?? 9}`;
      case 'ichimoku':
        return `ichimoku_${req.conversionPeriod ?? 9}_${req.basePeriod ?? 26}_${req.spanPeriod ?? 52}_${req.displacement ?? 26}`;
      case 'bb':
        return `bb_${req.period ?? 20}_${req.stdDev ?? 2}`;
      default:
        return `${req.name}_${req.period ?? (req.name === 'rsi' || req.name === 'atr' || req.name === 'sd' ? 14 : 20)}`;
    }
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
      chain.sort((a, b) => a.statusTimestamp - b.statusTimestamp);
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
}
