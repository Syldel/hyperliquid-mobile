import { Injectable } from '@angular/core';
import { IndicatorMetadata } from '@syldel/trading-shared-types';
import { IChartApi, ISeriesApi, LineSeries, LineStyle, Time } from 'lightweight-charts';
import { SubFieldStyle } from '../models/indicator.model';

/** Point brut renvoyé par /analysis pour un indicateur : au moins `time`, plus un ou plusieurs
 *  champs numériques selon l'indicateur (`value` pour EMA/RSI, `upper/middle/lower` pour BB, etc.). */
export type IndicatorPoint = { time: number } & Record<string, number | undefined>;

interface PaneEntry {
  paneIndex: number;
  seriesByField: Map<string, ISeriesApi<'Line'>>;
}

@Injectable({ providedIn: 'root' })
export class IndicatorOverlayService {
  private chart?: IChartApi;

  /** id d'indicateur -> field -> série (pane principal, overlay). */
  private overlaySeries = new Map<string, Map<string, ISeriesApi<'Line'>>>();
  /** id d'indicateur -> pane dédié partagé entre tous les champs de cet indicateur. */
  private paneSeries = new Map<string, PaneEntry>();

  attach(chart: IChartApi): void {
    this.chart = chart;
  }

  render(
    id: string,
    meta: IndicatorMetadata,
    points: IndicatorPoint[],
    defaultColor: string,
    subFieldStyles?: Record<string, SubFieldStyle>,
  ): void {
    if (!this.chart) return;

    const fields = meta.subFields?.length ? meta.subFields.map((f) => f.name) : ['value'];

    fields.forEach((field) => {
      const fieldPoints = points
        .filter((p) => typeof p[field] === 'number')
        .map((p) => ({ time: p.time, value: p[field] as number }));

      const style = subFieldStyles?.[field] ?? { color: defaultColor, lineStyle: 'solid' as const };
      const lineStyle = this.toLightweightLineStyle(style.lineStyle);

      if (meta.overlay) {
        this.renderOnMainPane(id, field, fieldPoints, style.color, lineStyle);
      } else {
        this.renderOnDedicatedPane(id, field, fieldPoints, style.color, lineStyle);
      }
    });
  }

  private toLightweightLineStyle(style: SubFieldStyle['lineStyle']): LineStyle {
    switch (style) {
      case 'dashed':
        return LineStyle.Dashed;
      case 'dotted':
        return LineStyle.Dotted;
      default:
        return LineStyle.Solid;
    }
  }

  private toChartPoints(points: { time: number; value: number }[]) {
    return points.map((p) => ({ time: Math.floor(p.time / 1000) as Time, value: p.value }));
  }

  private renderOnMainPane(
    id: string,
    field: string,
    points: { time: number; value: number }[],
    color: string,
    lineStyle: LineStyle,
  ): void {
    let byField = this.overlaySeries.get(id);
    if (!byField) {
      byField = new Map();
      this.overlaySeries.set(id, byField);
    }

    let series = byField.get(field);
    if (!series) {
      series = this.chart!.addSeries(LineSeries, { lineWidth: 1, color, lineStyle }, 0);
      byField.set(field, series);
    } else {
      series.applyOptions({ color, lineStyle });
    }
    series.setData(this.toChartPoints(points));
  }

  private renderOnDedicatedPane(
    id: string,
    field: string,
    points: { time: number; value: number }[],
    color: string,
    lineStyle: LineStyle,
  ): void {
    let entry = this.paneSeries.get(id);
    if (!entry) {
      const paneIndex = this.chart!.panes().length;
      entry = { paneIndex, seriesByField: new Map() };
      this.paneSeries.set(id, entry);
    }

    let series = entry.seriesByField.get(field);
    if (!series) {
      series = this.chart!.addSeries(
        LineSeries,
        { lineWidth: 1, color, lineStyle },
        entry.paneIndex,
      );
      entry.seriesByField.set(field, series);
    } else {
      series.applyOptions({ color, lineStyle });
    }
    series.setData(this.toChartPoints(points));
  }

  remove(id: string): void {
    const overlayFields = this.overlaySeries.get(id);
    if (overlayFields) {
      overlayFields.forEach((series) => this.chart?.removeSeries(series));
      this.overlaySeries.delete(id);
    }

    const paned = this.paneSeries.get(id);
    if (paned) {
      paned.seriesByField.forEach((series) => this.chart?.removeSeries(series));
      this.paneSeries.delete(id);
    }
  }

  reset(): void {
    this.chart = undefined;
    this.overlaySeries.clear();
    this.paneSeries.clear();
  }
}
