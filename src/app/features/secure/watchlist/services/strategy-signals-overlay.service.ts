import { Injectable } from '@angular/core';
import { TimelineSignal } from '@syldel/trading-shared-types';
import {
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
  createSeriesMarkers,
} from 'lightweight-charts';

@Injectable({ providedIn: 'root' })
export class StrategySignalsOverlayService {
  private markersPlugin?: ISeriesMarkersPluginApi<Time>;

  /** À appeler une fois candleSeries créée (dans buildChart(), juste après addSeries(CandlestickSeries, ...)). */
  attach(candleSeries: ISeriesApi<'Candlestick'>): void {
    this.markersPlugin = createSeriesMarkers(candleSeries, []);
  }

  render(signals: TimelineSignal[]): void {
    if (!this.markersPlugin) return; // pas encore attaché — appelant doit attendre buildChart()

    const markers: SeriesMarker<Time>[] = signals.map((s) => ({
      time: Math.floor(s.time / 1000) as Time,
      position: s.signal === 'ENTER' ? 'belowBar' : 'aboveBar',
      color: s.metadata?.['side'] === 'SHORT' ? '#eb445a' : '#2dd36f',
      shape: s.signal === 'ENTER' ? 'arrowUp' : 'arrowDown',
      text: `${s.signal} ${s.metadata?.['side'] ?? ''}`,
    }));

    this.markersPlugin.setMarkers(markers);
  }

  clear(): void {
    this.markersPlugin?.setMarkers([]);
  }

  /** À appeler dans ngOnDestroy du composant, avant chart.remove(). */
  reset(): void {
    this.markersPlugin?.detach();
    this.markersPlugin = undefined;
  }
}
