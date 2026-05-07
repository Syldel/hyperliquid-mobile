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
import { HyperliquidCandleService } from '@services/hyperliquid-candle.service';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { CandleInterval, CandleSnapshot } from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import { calendarOutline, refreshOutline } from 'ionicons/icons';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
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
import { WatchlistService } from '../../services/watchlist.service';

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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly watchlistService = inject(WatchlistService);
  private readonly lifecycle = inject(AppLifecycleService);

  readonly chartEl = viewChild<ElementRef<HTMLDivElement>>('chartEl');

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

  private chart?: IChartApi;
  private candleSeries?: ISeriesApi<'Candlestick'>;
  private volumeSeries?: ISeriesApi<'Histogram'>;
  private resizeObserver?: ResizeObserver;

  constructor() {
    addIcons({ calendarOutline, refreshOutline });

    const state = window.history.state as { backHref?: string };
    if (state?.backHref) this.backHref.set(state.backHref);

    effect(() => {
      const el = this.chartEl()?.nativeElement;
      if (!el || this.chart) return;
      untracked(() => this.buildChart(el));
    });

    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => this.fetchFn.set(this.buildFetchFn()));
    });
  }

  ngOnInit(): void {
    const coin = this.route.snapshot.paramMap.get('coin');
    if (!coin) {
      this.router.navigate(['/secure/watchlist']);
      return;
    }

    const found = this.watchlistService.getByCoin(coin);
    if (!found) {
      this.router.navigate(['/secure/watchlist']);
      return;
    }

    this.item.set(found);
    this.selectedInterval.set(found.interval);

    this.fetchFn.set(this.buildFetchFn());
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.remove();
  }

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
      upColor: '#2dd36f',
      downColor: '#eb445a',
      borderVisible: false,
      wickUpColor: '#2dd36f',
      wickDownColor: '#eb445a',
    });

    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      color: 'rgba(128,128,128,0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    this.chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    this.resizeObserver = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      this.chart?.applyOptions({ width: rect.width, height: rect.height || 400 });
    });
    this.resizeObserver.observe(el);
  }

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

  onPresetChange(preset: DatePreset): void {
    this.selectedPreset.set(preset);
    this.selectedInterval.set(preset.interval);
    this.loadData();
  }

  onIntervalChange(interval: CandleInterval): void {
    this.selectedInterval.set(interval);
    this.loadData();
  }

  get changeSign(): string {
    return this.priceChange() >= 0 ? '+' : '';
  }
}
