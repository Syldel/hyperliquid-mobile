import { Injectable } from '@angular/core';
import {
  IChartApi,
  IPaneApi,
  ISeriesApi,
  LineSeries,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { ExpressionSeries } from '../utils/expression-series.util';

/**
 * ============================================================================
 * 〰️ EXPRESSIONS RENDERING
 * Trace les opérandes qu'une stratégie compare — le débogage visuel d'une
 * règle : on y voit *pourquoi* une condition se déclenche, ou pourquoi elle ne
 * se déclenche jamais.
 *
 * Chaque expression va là où son échelle la place (`operand-scale.util.ts`) :
 * un niveau de prix — `EMA(9)`, `(EMA(20) + ATR(14))` — se dessine **sur les
 * bougies**, là où sa position par rapport au cours est la seule chose qui
 * compte ; le reste obtient un panneau, un par échelle. `zscore(...)` et
 * `percentile(...)` ne partagent donc pas le leur : entre -3 et +3 d'un côté,
 * 0 à 100 de l'autre, une échelle commune écraserait les deux.
 *
 * Les panneaux se partagent une hauteur totale fixe par facteurs d'étirement.
 * `setHeight` ne fait que proposer une valeur que la répartition écrase
 * aussitôt ; `setStretchFactor` est le seul levier qui tienne.
 * ============================================================================
 */

/** Groupe des expressions qui se dessinent sur l'échelle des bougies. */
export const PRICE_GROUP = 'price';

/** Une expression prête à tracer : sa série, sa couleur, son libellé, son échelle. */
export interface ExpressionLayer {
  id: string;
  label: string;
  color: string;
  /** `PRICE_GROUP` pour les bougies, sinon la clé d'échelle qui lui vaut un panneau. */
  group: string;
  series: ExpressionSeries;
}

/** Part de la hauteur du panneau des prix accordée à un panneau d'expressions. */
const PANE_STRETCH = 0.45;

@Injectable()
export class ExpressionsPaneService {
  private chart?: IChartApi;
  private readonly panes = new Map<string, IPaneApi<Time>>();
  private readonly series = new Map<string, { api: ISeriesApi<'Line'>; group: string }>();

  /** À appeler une fois le chart créé, comme les autres overlays. */
  attach(chart: IChartApi): void {
    this.chart = chart;
  }

  render(layers: readonly ExpressionLayer[]): void {
    if (!this.chart) return;

    this.dropSeriesAbsentFrom(layers);

    for (const layer of layers) {
      const api = this.seriesFor(layer);
      api.applyOptions({ color: layer.color, title: layer.label });
      // `Time` est un type marqué de lightweight-charts ; la conversion se fait
      // ici, à la frontière, pour que le calcul de la série reste indépendant
      // de la librairie de chart. Un point sans `value` est un whitespace : le
      // trait s'interrompt au lieu d'enjamber un trou (expression-series.util.ts).
      api.setData(
        layer.series.points.map((point) => ({ ...point, time: point.time as UTCTimestamp })),
      );
    }

    this.dropPanesAbsentFrom(layers);
    this.applyStretch();
  }

  /** Retire tout : séries et panneaux. */
  clear(): void {
    for (const { api } of this.series.values()) this.chart?.removeSeries(api);
    this.series.clear();
    this.removePanes([...this.panes.keys()]);
  }

  /** À appeler dans ngOnDestroy du composant, avant chart.remove(). */
  reset(): void {
    this.series.clear();
    this.panes.clear();
    this.chart = undefined;
  }

  /**
   * Série d'une expression, dans le panneau que son échelle lui vaut.
   *
   * Une expression qui change de groupe — le catalogue a été rechargé et
   * l'indicateur n'est plus un overlay — déménage plutôt que d'être recréée :
   * `moveToPane` conserve ses options et ses données.
   */
  private seriesFor(layer: ExpressionLayer): ISeriesApi<'Line'> {
    const existing = this.series.get(layer.id);

    if (existing) {
      if (existing.group !== layer.group) {
        existing.api.moveToPane(this.paneIndexFor(layer.group));
        this.series.set(layer.id, { api: existing.api, group: layer.group });
      }
      return existing.api;
    }

    const api = this.chart!.addSeries(
      LineSeries,
      { lineWidth: 1, priceLineVisible: false, lastValueVisible: true },
      this.paneIndexFor(layer.group),
    );

    this.series.set(layer.id, { api, group: layer.group });
    return api;
  }

  /** Index du panneau d'un groupe — 0 (les bougies) pour l'échelle des prix. */
  private paneIndexFor(group: string): number {
    if (group === PRICE_GROUP) return 0;

    const existing = this.panes.get(group);
    if (existing) return existing.paneIndex();

    // `preserveEmptyPane` : lightweight-charts supprime sinon le panneau dès
    // que sa dernière série disparaît, ce qui laisse une référence périmée et
    // fait lever `removePane` (« Invalid pane index ») au nettoyage suivant.
    const pane = this.chart!.addPane(true);
    this.panes.set(group, pane);
    return pane.paneIndex();
  }

  private dropSeriesAbsentFrom(layers: readonly ExpressionLayer[]): void {
    const kept = new Set(layers.map((layer) => layer.id));

    for (const [id, { api }] of this.series) {
      if (kept.has(id)) continue;
      this.chart?.removeSeries(api);
      this.series.delete(id);
    }
  }

  /** Un panneau sans expression n'a plus de raison d'occuper de la hauteur. */
  private dropPanesAbsentFrom(layers: readonly ExpressionLayer[]): void {
    const kept = new Set(layers.map((layer) => layer.group));
    this.removePanes([...this.panes.keys()].filter((group) => !kept.has(group)));
  }

  private removePanes(groups: readonly string[]): void {
    for (const group of groups) {
      const pane = this.panes.get(group);
      this.panes.delete(group);
      if (!pane || !this.chart) continue;

      const index = this.chart.panes().indexOf(pane);
      if (index >= 0) this.chart.removePane(index);
    }
  }

  private applyStretch(): void {
    const base = this.chart!.panes()[0]?.getStretchFactor() ?? 1;
    for (const pane of this.panes.values()) pane.setStretchFactor(base * PANE_STRETCH);
  }
}
