import { Injectable } from '@angular/core';
import {
  HistogramSeries,
  IChartApi,
  IPaneApi,
  ISeriesApi,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { buildPositionBars, buildPositionSegments } from '../utils/position-segments.util';
import type { StrategySignalLayer } from '../utils/strategy-markers.util';

/**
 * ============================================================================
 * 🟩 STRATEGY POSITIONS PANE
 * Panneau dédié sous les bougies — dans l'esprit d'un MACD — montrant, pour
 * chaque stratégie, quand une position est ouverte : vert en long, rouge en
 * short, vide à plat.
 *
 * Complète les marqueurs plutôt que de les remplacer : ceux-ci montrent des
 * **instants** (l'entrée, la sortie), celui-ci montre des **durées**. « Dans
 * quelle position suis-je à ce moment du chart » est une question qu'aucune
 * flèche ne peut trancher seule.
 *
 * Un panneau à part, et non une bande posée sur l'échelle des prix : il a sa
 * propre hauteur, ne rogne pas le graphe de prix, et grandit avec le nombre de
 * stratégies — ce qui rend la comparaison de plusieurs stratégies lisible.
 *
 * C'est aussi ce qui libère les marqueurs : le côté étant lisible ici, ils
 * n'ont plus qu'à distinguer entrée et sortie.
 * ============================================================================
 */

/**
 * Part de la hauteur du chart allouée à une ligne de stratégie, relativement au
 * panneau des prix.
 *
 * Les panneaux se partagent une hauteur totale fixe par facteurs d'étirement,
 * pas par pixels : `setHeight` ne fait que proposer une valeur que la
 * répartition écrase aussitôt. `setStretchFactor` est le seul levier qui tient.
 */
const ROW_STRETCH = 0.08;

/** Bornes : lisible à une stratégie, jamais envahissant à dix. */
const MIN_STRETCH = 0.2;
const MAX_STRETCH = 0.4;

/** Juste sous les bougies : c'est le contexte que la bande commente. */
const DESIRED_PANE_INDEX = 1;

/**
 * Vert et rouge, délibérément : ce sont les couleurs du long et du short
 * partout ailleurs sur un chart. La couleur propre à chaque stratégie reste
 * portée par ses marqueurs et sa puce, pas par ce panneau.
 */
const POSITION_COLORS = { long: '#2dd36f', short: '#eb445a' } as const;

@Injectable()
export class StrategyPositionsPaneService {
  private chart?: IChartApi;
  private pane?: IPaneApi<Time>;
  private readonly series = new Map<string, ISeriesApi<'Histogram'>>();

  /** À appeler une fois le chart créé, comme les autres overlays. */
  attach(chart: IChartApi): void {
    this.chart = chart;
  }

  /**
   * Redessine le panneau pour les couches fournies, dans leur ordre.
   *
   * `candleTimesMs` sert à étaler les segments : sans les bougies, une position
   * ne serait qu'un point de départ et un point d'arrivée, pas une barre.
   */
  render(layers: readonly StrategySignalLayer[], candleTimesMs: readonly number[]): void {
    if (!this.chart) return;

    if (layers.length === 0) {
      this.clear();
      return;
    }

    this.dropSeriesAbsentFrom(layers);
    const pane = this.ensurePane();

    layers.forEach((layer, row) => {
      const segments = buildPositionSegments(layer.signals);
      const bars = buildPositionBars(segments, candleTimesMs, row, POSITION_COLORS);

      const series = this.seriesFor(layer.strategyId, pane.paneIndex());
      // `base` suit la ligne : sans lui, chaque barre partirait de zéro et les
      // stratégies se recouvriraient au lieu de s'empiler.
      series.applyOptions({ base: row });
      // `Time` est un type marqué de lightweight-charts ; la conversion se fait
      // ici, à la frontière, pour que la fonction pure qui produit les barres
      // reste indépendante de la librairie de chart.
      series.setData(bars.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })));
      series.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } });
    });

    pane.setStretchFactor(this.stretchFor(layers.length));
  }

  /**
   * Retire les séries ET le panneau : un panneau vide occuperait de la place
   * pour rien.
   *
   * L'ordre compte. lightweight-charts supprime **lui-même** un panneau dès que
   * sa dernière série disparaît (`_cleanupIfPaneIsEmpty`), si bien que retirer
   * les séries puis appeler `removePane` visait un index périmé et levait
   * « Invalid pane index » — l'exception interrompait le rendu en cours et
   * laissait le chart à moitié dessiné. Le panneau est donc créé avec
   * `preserveEmptyPane`, ce qui nous en rend la durée de vie, et on vérifie
   * qu'il est encore attaché avant de le retirer.
   */
  clear(): void {
    for (const series of this.series.values()) this.chart?.removeSeries(series);
    this.series.clear();

    const pane = this.pane;
    this.pane = undefined;
    if (!pane || !this.chart) return;

    const index = this.chart.panes().indexOf(pane);
    if (index >= 0) this.chart.removePane(index);
  }

  /** À appeler dans ngOnDestroy du composant, avant chart.remove(). */
  reset(): void {
    this.series.clear();
    this.pane = undefined;
    this.chart = undefined;
  }

  /**
   * `preserveEmptyPane` : voir `clear`. `moveTo` fixe la place du panneau au
   * lieu de la laisser dépendre de l'ordre de création — sans quoi une bande
   * masquée puis réaffichée réapparaissait tout en bas, sous les autres
   * panneaux ajoutés entre-temps.
   */
  private ensurePane(): IPaneApi<Time> {
    if (!this.pane) {
      this.pane = this.chart!.addPane(true);
      this.pane.moveTo(Math.min(DESIRED_PANE_INDEX, this.chart!.panes().length - 1));
    }

    return this.pane;
  }

  private stretchFor(rows: number): number {
    const base = this.chart!.panes()[0]?.getStretchFactor() ?? 1;
    return base * Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, rows * ROW_STRETCH));
  }

  private seriesFor(strategyId: string, paneIndex: number): ISeriesApi<'Histogram'> {
    const existing = this.series.get(strategyId);
    if (existing) return existing;

    const series = this.chart!.addSeries(
      HistogramSeries,
      {
        priceLineVisible: false,
        lastValueVisible: false,
        // L'axe de ce panneau compte des lignes, pas des prix : afficher « 0.8 »
        // ou « 1.8 » n'apprendrait rien et brouillerait la lecture.
        priceFormat: { type: 'custom', formatter: () => '', minMove: 0.01 },
      },
      paneIndex,
    );

    this.series.set(strategyId, series);
    return series;
  }

  private dropSeriesAbsentFrom(layers: readonly StrategySignalLayer[]): void {
    const kept = new Set(layers.map((layer) => layer.strategyId));

    for (const [strategyId, series] of this.series) {
      if (kept.has(strategyId)) continue;
      this.chart?.removeSeries(series);
      this.series.delete(strategyId);
    }
  }
}
