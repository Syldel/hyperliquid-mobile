import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HyperliquidCandleService } from '@services/hyperliquid-candle.service';
import { CandleInterval, CandleSnapshot } from '@syldel/hl-shared-types';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineWidth,
  createChart,
} from 'lightweight-charts';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-mini-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mini-chart.component.html',
  styleUrls: ['./mini-chart.component.scss'],
})
export class MiniChartComponent implements OnDestroy {
  private readonly hlCandle = inject(HyperliquidCandleService);

  // ── Inputs ─────────────────────────────────────────────────────────────────
  readonly coin = input.required<string>();
  readonly interval = input<CandleInterval>('1h');
  readonly count = input<number>(60);

  // ── Outputs ─────────────────────────────────────────────────────────────────
  readonly chartClick = output<void>();

  // ── View ref ───────────────────────────────────────────────────────────────
  readonly chartEl = viewChild<ElementRef<HTMLDivElement>>('chartEl');

  // ── State ──────────────────────────────────────────────────────────────────
  readonly loading = signal(false);
  readonly hasError = signal(false);

  // ── Chart internals ────────────────────────────────────────────────────────
  private chart?: IChartApi;
  private areaSeries?: ISeriesApi<'Area'>;
  private resizeObserver?: ResizeObserver;

  constructor() {
    // Construit le chart dès que l'élément DOM est disponible
    effect(() => {
      const el = this.chartEl()?.nativeElement;
      if (!el || this.chart) return;
      untracked(() => this.buildChart(el));
    });

    // Re-fetch si coin, interval ou count changent
    effect(() => {
      const coin = this.coin();
      const interval = this.interval();
      const count = this.count();
      untracked(() => this.fetchCandles(coin, interval, count));
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.remove();
  }

  // ── Chart setup ────────────────────────────────────────────────────────────

  private buildChart(el: HTMLDivElement): void {
    const rect = el.getBoundingClientRect();
    const w = rect.width || 120;
    const h = rect.height || 50;

    this.chart = createChart(el, {
      width: w,
      height: h,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'transparent',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: { mode: CrosshairMode.Hidden },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      handleScroll: false,
      handleScale: false,
    });

    this.areaSeries = this.chart.addSeries(AreaSeries, {
      lineWidth: 1 as LineWidth,
      lineColor: '#4e9eff',
      topColor: 'rgba(78,158,255,0.2)',
      bottomColor: 'rgba(78,158,255,0)',
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    this.resizeObserver = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      this.chart?.applyOptions({ width: r.width, height: r.height || 50 });
    });
    this.resizeObserver.observe(el);

    this.fetchCandles(this.coin(), this.interval(), this.count());
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────

  private async fetchCandles(coin: string, interval: CandleInterval, count: number): Promise<void> {
    if (!this.chart || !coin) return;

    this.loading.set(true);
    this.hasError.set(false);

    try {
      const candles = await firstValueFrom(this.hlCandle.getRecentCandles(coin, interval, count));

      if (!candles.length) {
        this.hasError.set(true);
        return;
      }

      this.renderCandles(candles);
      this.updateColor(candles);
    } catch {
      this.hasError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private renderCandles(candles: CandleSnapshot[]): void {
    this.areaSeries?.setData(
      candles.map((c) => ({
        time: Math.floor(c.t / 1000) as any,
        value: parseFloat(c.c),
      })),
    );
    this.chart?.timeScale().fitContent();
  }

  /** Courbe verte si hausse, rouge si baisse. */
  private updateColor(candles: CandleSnapshot[]): void {
    const first = parseFloat(candles[0].o);
    const last = parseFloat(candles[candles.length - 1].c);
    const up = last >= first;

    this.areaSeries?.applyOptions({
      lineColor: up ? '#2dd36f' : '#eb445a',
      topColor: up ? 'rgba(45,211,111,0.2)' : 'rgba(235,68,90,0.2)',
      bottomColor: 'rgba(0,0,0,0)',
    });
  }
}
