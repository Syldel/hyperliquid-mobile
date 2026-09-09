import { Injectable } from '@angular/core';
import { ISeriesApi, ISeriesMarkersPluginApi, Time, createSeriesMarkers } from 'lightweight-charts';
import { buildStrategyMarkers, type StrategySignalLayer } from '../utils/strategy-markers.util';

/**
 * Marqueurs d'entrée/sortie des stratégies affichées sur le chart.
 *
 * Le chart ne possède qu'un jeu de marqueurs pour la série de bougies : les
 * couches sont donc fusionnées avant d'être posées (voir `buildStrategyMarkers`,
 * qui porte la fusion et le tri, testables sans chart).
 */
@Injectable({ providedIn: 'root' })
export class StrategySignalsOverlayService {
  private markersPlugin?: ISeriesMarkersPluginApi<Time>;

  /** À appeler une fois candleSeries créée (dans buildChart(), juste après addSeries(CandlestickSeries, ...)). */
  attach(candleSeries: ISeriesApi<'Candlestick'>): void {
    this.markersPlugin = createSeriesMarkers(candleSeries, []);
  }

  /** Remplace l'intégralité des marqueurs par ceux des couches fournies. */
  render(layers: readonly StrategySignalLayer[]): void {
    if (!this.markersPlugin) return; // pas encore attaché — appelant doit attendre buildChart()

    this.markersPlugin.setMarkers(buildStrategyMarkers(layers));
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
