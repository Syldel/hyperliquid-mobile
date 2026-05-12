import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  AlertController,
  IonCard,
  IonCardContent,
  IonIcon,
  IonSkeletonText,
  ModalController,
} from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidCandleService } from '@services/hyperliquid-candle.service';
import { CandleInterval, CandleSnapshot } from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import {
  closeOutline,
  ellipsisHorizontalOutline,
  trendingDownOutline,
  trendingUpOutline,
} from 'ionicons/icons';
import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  createChart,
  IChartApi,
  ISeriesApi,
  Time,
} from 'lightweight-charts';
import { WatchlistItem } from '../../models/watchlist-item.model';

@Component({
  selector: 'app-watchlist-card',
  templateUrl: './watchlist-card.component.html',
  styleUrls: ['./watchlist-card.component.scss'],
  standalone: true,
  imports: [CommonModule, IonCard, IonCardContent, IonIcon, IonSkeletonText, SmartDecimalPipe],
})
export class WatchlistCardComponent implements AfterViewInit, OnDestroy {
  // ── Inputs / Outputs ────────────────────────────────────────────────────────
  readonly item = input.required<WatchlistItem>();
  readonly removeRequested = output<string>();
  readonly itemUpdated = output<{ coin: string } & Partial<WatchlistItem>>();
  readonly clicked = output<string>();

  // ── View query — always in DOM, never inside @if ────────────────────────────
  readonly chartEl = viewChild<ElementRef<HTMLDivElement>>('chartEl');

  private readonly hlCandle = inject(HyperliquidCandleService);
  private readonly alertCtrl = inject(AlertController);
  private readonly lifecycle = inject(AppLifecycleService);
  private readonly modalCtrl = inject(ModalController);

  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;

  // ── State signals ───────────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly hasError = signal(false);
  readonly currentPrice = signal<number>(0);
  readonly priceChange = signal<number>(0);

  // ── Computed ────────────────────────────────────────────────────────────────
  readonly changeSign = computed(() => (this.priceChange() >= 0 ? '+' : ''));

  constructor() {
    addIcons({ closeOutline, trendingUpOutline, trendingDownOutline, ellipsisHorizontalOutline });

    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => this.loadData());
    });
  }

  ngAfterViewInit(): void {
    this.initChart();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.chart?.remove();
  }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this.clicked.emit(this.item().coin);
  }

  async openEditModal(event: Event): Promise<void> {
    event.stopPropagation();

    const { AddWatchlistModalComponent } =
      await import('../add-watchlist-modal/add-watchlist-modal.component');

    const modal = await this.modalCtrl.create({
      component: AddWatchlistModalComponent,
      componentProps: {
        initialItem: signal(this.item()),
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<{ coin: string; interval: CandleInterval }>();
    if (role === 'confirm' && data) {
      this.itemUpdated.emit(data);
      this.loadDataWith(data.coin, data.interval);
    }
  }

  async confirmRemove(event: Event): Promise<void> {
    event.stopPropagation();
    const { coin } = this.item();
    const alert = await this.alertCtrl.create({
      header: 'Remove from watchlist',
      message: `Remove ${coin}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => this.removeRequested.emit(coin),
        },
      ],
    });
    await alert.present();
  }

  private initChart(): void {
    const el = this.chartEl()?.nativeElement;
    if (!el) return;

    this.chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255,255,255,0.3)',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      handleScroll: false,
      handleScale: false,
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: '#26c17b',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26c17b',
      wickDownColor: '#ef5350',
    });
  }

  private loadData(): void {
    const { coin, interval } = this.item();
    this.loadDataWith(coin, interval);
  }

  private loadDataWith(coin: string, interval: CandleInterval): void {
    this.loading.set(true);
    this.hasError.set(false);
    this.hlCandle.getRecentCandles(coin, interval).subscribe({
      next: (candles: CandleSnapshot[]) => {
        if (!candles.length) {
          this.hasError.set(true);
          this.loading.set(false);
          return;
        }

        const data: CandlestickData<Time>[] = candles.map((c) => ({
          time: (c.t / 1000) as Time,
          open: parseFloat(c.o),
          high: parseFloat(c.h),
          low: parseFloat(c.l),
          close: parseFloat(c.c),
        }));

        this.series?.setData(data);

        const last = candles[candles.length - 1];
        const first = candles[0];
        this.currentPrice.set(parseFloat(last.c));
        this.priceChange.set(
          ((parseFloat(last.c) - parseFloat(first.o)) / parseFloat(first.o)) * 100,
        );
        this.loading.set(false);

        // Container était visibility:hidden — on redonne les vraies dimensions
        requestAnimationFrame(() => {
          const el = this.chartEl()?.nativeElement;
          if (!el) return;
          this.chart?.applyOptions({ width: el.clientWidth, height: el.clientHeight });
          this.chart?.timeScale().fitContent();
        });
      },
      error: () => {
        this.hasError.set(true);
        this.loading.set(false);
      },
    });
  }
}
