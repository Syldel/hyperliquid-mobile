import { Injectable } from '@angular/core';
import { IndicatorMetadata } from '@syldel/trading-shared-types';
import {
  BaselineSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeries,
  LineStyle,
  Time,
} from 'lightweight-charts';
import { IndicatorHlineStyles, SubFieldStyle } from '../models/indicator.model';

/** Point brut renvoyé par /analysis pour un indicateur : au moins `time`, plus un ou plusieurs
 *  champs numériques selon l'indicateur (`value` pour EMA/RSI, `upper/middle/lower` pour BB, etc.). */
export type IndicatorPoint = { time: number } & Record<string, number | undefined>;

interface PaneEntry {
  /** Pas de paneIndex mis en cache ici : lightweight-charts retire lui-même les panes
   *  vides (dès qu'on enlève toutes leurs séries) et redécale les suivants — un
   *  index stocké devient donc faux dès qu'un AUTRE indicateur dédié est retiré. On
   *  ne connaît la position réelle d'un pane qu'en la redemandant à une série qui y
   *  vit déjà, via `series.getPane().paneIndex()`. */
  seriesByField: Map<string, ISeriesApi<'Line'>>;
}

@Injectable({ providedIn: 'root' })
export class IndicatorOverlayService {
  private chart?: IChartApi;

  /** id d'indicateur -> field -> série (pane principal, overlay). */
  private overlaySeries = new Map<string, Map<string, ISeriesApi<'Line'>>>();
  /** id d'indicateur -> pane dédié partagé entre tous les champs de cet indicateur. */
  private paneSeries = new Map<string, PaneEntry>();
  /** id d'indicateur -> price lines des Levels (RSI/Stoch RSI/CHOP), attachées à la
   *  première série du pane dédié. */
  private hlinePriceLines = new Map<string, IPriceLine[]>();
  /** id d'indicateur -> id de zone -> série Baseline utilisée pour dessiner la bande colorée. */
  private zoneSeries = new Map<string, Map<string, ISeriesApi<'Baseline'>>>();

  attach(chart: IChartApi): void {
    this.chart = chart;
  }

  render(
    id: string,
    meta: IndicatorMetadata,
    points: IndicatorPoint[],
    defaultColor: string,
    subFieldStyles?: Record<string, SubFieldStyle>,
    hlines?: IndicatorHlineStyles,
  ): void {
    if (!this.chart) return;

    const fields = meta.subFields?.length ? meta.subFields.map((f) => f.name) : ['value'];

    fields.forEach((field) => {
      const style = subFieldStyles?.[field] ?? {
        color: defaultColor,
        lineStyle: 'solid' as const,
        visible: true,
      };

      if (style.visible === false) {
        this.removeField(id, field);
        return;
      }

      const fieldPoints = points
        .filter((p) => typeof p[field] === 'number')
        .map((p) => ({ time: p.time, value: p[field] as number }));

      const lineStyle = this.toLightweightLineStyle(style.lineStyle);

      if (meta.overlay) {
        this.renderOnMainPane(id, field, fieldPoints, style.color, lineStyle);
      } else {
        this.renderOnDedicatedPane(id, field, fieldPoints, style.color, lineStyle);
      }
    });

    // Levels/Zones (RSI, Stoch RSI, CHOP) : uniquement sur un pane dédié, purement
    // visuel — aucun rapport avec le calcul de l'indicateur.
    this.renderHlines(id, points, hlines);
  }

  /** Retire la série d'un seul champ (contrairement à `remove()` qui retire tout l'indicateur). */
  private removeField(id: string, field: string): void {
    const overlayFields = this.overlaySeries.get(id);
    const overlaySerie = overlayFields?.get(field);
    if (overlaySerie) {
      this.chart?.removeSeries(overlaySerie);
      overlayFields!.delete(field);
    }

    const paned = this.paneSeries.get(id);
    const panedSerie = paned?.seriesByField.get(field);
    if (panedSerie) {
      this.chart?.removeSeries(panedSerie);
      paned!.seriesByField.delete(field);
    }
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

  /** Position réelle ACTUELLE du pane où vit déjà cet indicateur dédié, ou
   *  `undefined` s'il n'a encore aucune série (donc aucun pane). Ne renvoie jamais
   *  une valeur mise en cache : toujours interrogée en direct sur une série vivante. */
  private currentPaneIndexOf(entry: PaneEntry): number | undefined {
    const anySeries = entry.seriesByField.values().next().value;
    return anySeries?.getPane().paneIndex();
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
      entry = { seriesByField: new Map() };
      this.paneSeries.set(id, entry);
    }

    let series = entry.seriesByField.get(field);
    if (!series) {
      // Un autre champ du MÊME indicateur (ex: k/d/stochRSI) vit peut-être déjà dans
      // un pane : on réutilise sa position réelle actuelle plutôt qu'un index mis en
      // cache. Sinon (premier champ de cet indicateur), on ajoute à la suite des
      // panes existants — fiable car interrogé en direct, pas stocké.
      const paneIndex = this.currentPaneIndexOf(entry) ?? this.chart!.panes().length;
      series = this.chart!.addSeries(LineSeries, { lineWidth: 1, color, lineStyle }, paneIndex);
      entry.seriesByField.set(field, series);
    } else {
      series.applyOptions({ color, lineStyle });
    }
    series.setData(this.toChartPoints(points));
  }

  /** Dessine les Levels (price lines natives) et Zones (séries Baseline pour le
   *  fill) sur le pane dédié de l'indicateur. Ne fait rien pour un indicateur
   *  overlay (pas de pane dédié) ou sans `hlines`. Toujours rebuild complet —
   *  plus simple à maintenir que de diffuser les ajouts/suppressions individuels
   *  faits dans le picker, et peu coûteux (appelé seulement au fetch/toggle). */
  private renderHlines(id: string, points: IndicatorPoint[], hlines?: IndicatorHlineStyles): void {
    const entry = this.paneSeries.get(id);
    this.clearHlines(id);
    if (!entry || !hlines) return;

    const anchorSeries = entry.seriesByField.values().next().value;
    if (!anchorSeries) return;

    const priceLines = hlines.lines
      .filter((l) => l.visible)
      .map((l) =>
        anchorSeries.createPriceLine({
          price: l.value,
          color: l.color,
          lineWidth: 1,
          lineStyle: this.toLightweightLineStyle(l.lineStyle),
          axisLabelVisible: true,
          title: '',
        }),
      );
    if (priceLines.length) this.hlinePriceLines.set(id, priceLines);

    const visibleZones = hlines.zones.filter((z) => z.visible);
    if (!visibleZones.length || !points.length) return;

    // Position réelle actuelle du pane de cet indicateur — jamais mise en cache
    // (cf. currentPaneIndexOf), pour rester correcte même si un AUTRE indicateur
    // dédié a été retiré entre-temps et a fait glisser les panes suivants.
    const paneIndex = anchorSeries.getPane().paneIndex();
    const times = points.map((p) => Math.floor(p.time / 1000) as Time);
    const zoneMap = new Map<string, ISeriesApi<'Baseline'>>();

    visibleZones.forEach((z) => {
      const top = Math.max(z.upperValue, z.lowerValue);
      const base = Math.min(z.upperValue, z.lowerValue);
      const fill = this.hexToRgba(z.color, z.opacity);

      const series = this.chart!.addSeries(
        BaselineSeries,
        {
          baseValue: { type: 'price', price: base },
          topLineColor: 'transparent',
          bottomLineColor: 'transparent',
          topFillColor1: fill,
          topFillColor2: fill,
          bottomFillColor1: 'transparent',
          bottomFillColor2: 'transparent',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        },
        paneIndex,
      );
      series.setData(times.map((time) => ({ time, value: top })));
      zoneMap.set(z.id, series);
    });

    if (zoneMap.size) this.zoneSeries.set(id, zoneMap);
  }

  private clearHlines(id: string): void {
    const lines = this.hlinePriceLines.get(id);
    if (lines?.length) {
      const anchorSeries = this.paneSeries.get(id)?.seriesByField.values().next().value;
      lines.forEach((pl) => {
        try {
          anchorSeries?.removePriceLine(pl);
        } catch {
          /* série déjà supprimée (indicateur retiré entre-temps) */
        }
      });
    }
    this.hlinePriceLines.delete(id);

    const zoneMap = this.zoneSeries.get(id);
    zoneMap?.forEach((series) => this.chart?.removeSeries(series));
    this.zoneSeries.delete(id);
  }

  private hexToRgba(hex: string, opacityPercent: number): string {
    const clean = hex.replace('#', '');
    const value = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    const alpha = Math.max(0, Math.min(100, opacityPercent)) / 100;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  remove(id: string): void {
    const overlayFields = this.overlaySeries.get(id);
    if (overlayFields) {
      overlayFields.forEach((series) => this.chart?.removeSeries(series));
      this.overlaySeries.delete(id);
    }

    this.clearHlines(id);

    const paned = this.paneSeries.get(id);
    if (paned) {
      paned.seriesByField.forEach((series) => this.chart?.removeSeries(series));
      this.paneSeries.delete(id);
      // Pas de removePane ici : instable en présence de plusieurs panes (cf.
      // historique). lightweight-charts retire lui-même le pane devenu vide et
      // redécale les suivants — c'est justement pour ça qu'on ne met plus AUCUN
      // paneIndex en cache nulle part dans ce service.
    }
  }

  reset(): void {
    this.chart = undefined;
    this.overlaySeries.clear();
    this.paneSeries.clear();
    this.hlinePriceLines.clear();
    this.zoneSeries.clear();
  }
}
