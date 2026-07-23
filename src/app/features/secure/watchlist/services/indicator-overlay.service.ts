import { Injectable } from '@angular/core';
import { IndicatorMetadata } from '@syldel/trading-shared-types';
import { IChartApi, ISeriesApi, LineSeries, Time } from 'lightweight-charts';

@Injectable({ providedIn: 'root' })
export class IndicatorOverlayService {
  private chart?: IChartApi;
  private overlaySeries = new Map<string, ISeriesApi<'Line'>>();
  private paneSeries = new Map<string, { paneIndex: number; series: ISeriesApi<'Line'> }>();

  /** À appeler une fois le chart construit (dans buildChart(), après createChart()). */
  attach(chart: IChartApi): void {
    this.chart = chart;
  }

  render(id: string, meta: IndicatorMetadata, points: { time: number; value: number }[]): void {
    if (!this.chart) return; // chart pas encore prêt — appelant doit attendre buildChart()

    if (meta.overlay) {
      this.renderOnMainPane(id, points);
    } else {
      this.renderOnDedicatedPane(id, points);
    }
  }

  private renderOnMainPane(id: string, points: { time: number; value: number }[]): void {
    let series = this.overlaySeries.get(id);
    if (!series) {
      series = this.chart!.addSeries(LineSeries, { lineWidth: 1 }, 0);
      this.overlaySeries.set(id, series);
    }
    series.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
  }

  private renderOnDedicatedPane(id: string, points: { time: number; value: number }[]): void {
    let entry = this.paneSeries.get(id);
    if (!entry) {
      const paneIndex = this.chart!.panes().length;
      const series = this.chart!.addSeries(LineSeries, { lineWidth: 1 }, paneIndex);
      entry = { paneIndex, series };
      this.paneSeries.set(id, entry);
    }
    entry.series.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
  }

  remove(id: string): void {
    const overlay = this.overlaySeries.get(id);
    if (overlay) {
      this.chart?.removeSeries(overlay);
      this.overlaySeries.delete(id);
    }
    const paned = this.paneSeries.get(id);
    if (paned) {
      this.chart?.removeSeries(paned.series);
      this.paneSeries.delete(id);
    }
  }

  /** À appeler dans ngOnDestroy du composant, avant chart.remove(). */
  reset(): void {
    this.chart = undefined;
    this.overlaySeries.clear();
    this.paneSeries.clear();
  }
}
