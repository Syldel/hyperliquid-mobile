import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { ColorType, createChart, IChartApi, LineSeries, LineStyle, Time } from 'lightweight-charts';
import { formatPercent } from '../../utils/backtest-display.util';

export interface EquityCurveLine {
  id: string;
  color: string;
  /** Temps en MILLISECONDES, comme le rapport ; converti ici en secondes. */
  points: readonly { time: number; value: number }[];
  /** La courbe principale est plus épaisse que les côtés qui la composent. */
  emphasis: boolean;
}

/**
 * La courbe de performance d'un backtest, dans un chart à part.
 *
 * Pas un pane du chart principal : avec les bougies, la bande de positions et
 * les expressions, la hauteur partagée est déjà rationnée (voir
 * docs/watchlist/chart-overlays.md, « Les hauteurs sont des facteurs »).
 *
 * Construit une fois, à l'affichage : ce composant vit dans une modale dont le
 * rapport ne change pas pendant qu'elle est ouverte.
 */
@Component({
  selector: 'app-equity-curve',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div #host class="equity-curve"></div>',
  styles: [
    `
      .equity-curve {
        width: 100%;
        height: 180px;
      }
    `,
  ],
})
export class EquityCurveComponent implements AfterViewInit, OnDestroy {
  readonly lines = input.required<readonly EquityCurveLine[]>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private chart?: IChartApi;
  private resizeObserver?: ResizeObserver;

  ngAfterViewInit(): void {
    const el = this.host().nativeElement;

    this.chart = createChart(el, {
      width: el.clientWidth,
      height: 180,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor:
          getComputedStyle(document.documentElement).getPropertyValue('--ion-text-color') || '#ccc',
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(128,128,128,0.1)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale: false,
    });

    this.lines().forEach((line, index) => {
      const series = this.chart!.addSeries(LineSeries, {
        color: line.color,
        lineWidth: line.emphasis ? 2 : 1,
        lineStyle: line.emphasis ? LineStyle.Solid : LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: line.emphasis,
        priceFormat: {
          type: 'custom',
          formatter: (value: number) => formatPercent(value),
          minMove: 0.01,
        },
      });
      series.setData(
        line.points.map((point) => ({
          time: Math.floor(point.time / 1000) as Time,
          value: point.value,
        })),
      );

      // Le zéro est la seule référence qui compte ici : au-dessus on gagne, en
      // dessous on perd. Une ligne suffit, sur la première série.
      if (index === 0) {
        series.createPriceLine({
          price: 0,
          color: 'rgba(128,128,128,0.5)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
        });
      }
    });

    this.chart.timeScale().fitContent();

    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.applyOptions({ width: el.clientWidth });
      this.chart?.timeScale().fitContent();
    });
    this.resizeObserver.observe(el);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.remove();
    this.chart = undefined;
  }
}
