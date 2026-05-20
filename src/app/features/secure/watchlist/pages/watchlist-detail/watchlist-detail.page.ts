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
import { HyperliquidCacheService } from '@services/hyperliquid-cache.service';
import { HyperliquidCandleService } from '@services/hyperliquid-candle.service';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import {
  CandleInterval,
  CandleSnapshot,
  HLFrontendOpenOrder,
  HLUserFill,
} from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import { calendarOutline, refreshOutline } from 'ionicons/icons';
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
  CANDLE_INTERVALS,
  DATE_PRESETS,
  DatePreset,
  INTERVAL_LABELS,
  WatchlistItem,
} from '../../models/watchlist-item.model';

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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lifecycle = inject(AppLifecycleService);

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

  // ── Overlay internals ──────────────────────────────────────────────────────
  private overlayCtx?: CanvasRenderingContext2D;
  private animFrame?: number;
  private priceLines: IPriceLine[] = [];

  // ── Colors ─────────────────────────────────────────────────────────────────
  private readonly COLOR_BUY = '#2dd36f';
  private readonly COLOR_SELL = '#eb445a';
  private readonly COLOR_TPSL = '#f4a261';

  constructor() {
    addIcons({ calendarOutline, refreshOutline });

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
  }

  ngOnDestroy(): void {
    const el = this.chartEl()?.nativeElement;
    if (el) {
      el.removeEventListener('mouseup', this.onMouseUp);
      el.removeEventListener('touchend', this.onTouchEnd);
    }
    this.resizeObserver?.disconnect();
    this.clearOverlay();
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

        this.renderCandles(candles);
        this.computeStats(candles);

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

    this.drawFills(ctx, snap.fills);
    this.drawOpenOrders(ctx, snap.openOrders);
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

  private getOrderPrice(order: HLFrontendOpenOrder): string {
    if ((order.isTrigger || order.isPositionTpsl) && parseFloat(order.triggerPx) > 0) {
      return order.triggerPx;
    }
    return order.limitPx;
  }

  private drawOpenOrders(ctx: CanvasRenderingContext2D, orders: HLFrontendOpenOrder[]): void {
    if (!orders.length) return;

    const visibleRange = this.chart!.timeScale().getVisibleRange();
    const rightTime = visibleRange?.to ?? null;

    for (const order of orders) {
      const priceLabel = this.getOrderPrice(order);
      const price = parseFloat(priceLabel);
      const y = this.candleSeries!.priceToCoordinate(price);
      if (y === null || y < 0 || y > ctx.canvas.height) continue;

      const { color, label, dash } = this.getOrderStyle(order);

      // Ligne
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.moveTo(0, y);
      ctx.lineTo(ctx.canvas.width, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Pastille prix bord droit
      if (rightTime !== null) {
        const x = this.chart!.timeScale().timeToCoordinate(rightTime);
        if (x !== null) {
          const fSize = 10;
          ctx.font = `${fSize}px monospace`;
          const tw = ctx.measureText(priceLabel).width;
          const padX = 6,
            padY = 4;

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(
            x - tw - padX * 2,
            y - fSize / 2 - padY,
            tw + padX * 2,
            fSize + padY * 2,
            3,
          );
          ctx.fill();

          ctx.fillStyle = '#000';
          ctx.fillText(priceLabel, x - tw - padX, y + fSize / 2 - 2);
        }
      }

      // Label type + size bord gauche
      ctx.fillStyle = color;
      ctx.font = '10px monospace';
      ctx.fillText(`${label}  ${parseFloat(order.sz).toFixed(4)}`, 8, y - 4);
    }
  }

  private getOrderStyle(order: HLFrontendOpenOrder): {
    color: string;
    label: string;
    dash: number[];
  } {
    const type = order.orderType.toLowerCase();

    if (type.includes('take profit')) {
      return { color: '#2dd36f', label: 'TP', dash: [6, 3] };
    }
    if (type.includes('stop')) {
      return { color: '#eb445a', label: 'SL', dash: [6, 3] };
    }
    // Limit order classique
    const isBuy = order.side === 'B';
    return {
      color: isBuy ? this.COLOR_BUY : this.COLOR_SELL,
      label: isBuy ? 'BUY' : 'SELL',
      dash: [],
    };
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
}
