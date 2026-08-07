import { inject, Injectable } from '@angular/core';
import { StorageService } from '@storage/storage.service';
import { IndicatorHlineStyles, SubFieldStyle } from '../models/indicator.model';

type ColorMap = Record<string, string>;
type SubFieldStyleMap = Record<string, SubFieldStyle>;
type HlineStyleMap = Record<string, IndicatorHlineStyles>;

@Injectable({ providedIn: 'root' })
export class IndicatorColorService {
  private readonly storage = inject(StorageService);
  private readonly STORAGE_KEY = 'indicator_colors';
  private readonly SUBFIELD_STORAGE_KEY = 'indicator_subfield_styles';
  private readonly HLINE_STORAGE_KEY = 'indicator_hline_styles';

  private cache: ColorMap | null = null;
  private subFieldCache: SubFieldStyleMap | null = null;
  private hlineCache: HlineStyleMap | null = null;

  // ── API existante (indicateurs simples) ───────────────────────────────────
  async peek(indicatorKey: string): Promise<string | undefined> {
    return (await this.loadAll())[indicatorKey];
  }

  async getOrCreate(indicatorKey: string): Promise<string> {
    const all = await this.loadAll();
    if (all[indicatorKey]) return all[indicatorKey];
    const color = this.randomColor();
    await this.set(indicatorKey, color);
    return color;
  }

  async set(indicatorKey: string, color: string): Promise<void> {
    const all = await this.loadAll();
    all[indicatorKey] = color;
    this.cache = all;
    await this.storage.set(this.STORAGE_KEY, all);
  }

  // ── API : styles par sous-champ (indicateurs multi-lignes) ────────────────
  private subFieldKey(indicatorKey: string, field: string): string {
    return `${indicatorKey}:${field}`;
  }

  async peekSubField(indicatorKey: string, field: string): Promise<SubFieldStyle | undefined> {
    return (await this.loadSubFieldAll())[this.subFieldKey(indicatorKey, field)];
  }

  async setSubField(indicatorKey: string, field: string, style: SubFieldStyle): Promise<void> {
    const all = await this.loadSubFieldAll();
    all[this.subFieldKey(indicatorKey, field)] = style;
    this.subFieldCache = all;
    await this.storage.set(this.SUBFIELD_STORAGE_KEY, all);
  }

  /** Renvoie le style stocké s'il existe, sinon le défaut TradingView pour cet indicateur/champ,
   *  sinon une couleur aléatoire (hors plage rouge/vert) en dernier recours. */
  async getOrCreateSubField(
    indicatorKey: string,
    field: string,
    fallbackDefault: SubFieldStyle,
  ): Promise<SubFieldStyle> {
    const stored = await this.peekSubField(indicatorKey, field);
    if (stored) return stored;
    await this.setSubField(indicatorKey, field, fallbackDefault);
    return fallbackDefault;
  }

  // ── API : Levels/Zones (RSI, Stoch RSI, CHOP) ─────────────────────────────
  async peekHlines(indicatorKey: string): Promise<IndicatorHlineStyles | undefined> {
    return (await this.loadHlineAll())[indicatorKey];
  }

  /** Renvoie le jeu de Levels/Zones stocké pour cette clé d'indicateur, sinon
   *  persiste et renvoie `fallback` (un jeu de départ, cf. buildDefaultHlineStyles). */
  async getOrCreateHlines(
    indicatorKey: string,
    fallback: IndicatorHlineStyles,
  ): Promise<IndicatorHlineStyles> {
    const stored = await this.peekHlines(indicatorKey);
    if (stored) return stored;
    await this.setHlines(indicatorKey, fallback);
    return fallback;
  }

  async setHlines(indicatorKey: string, styles: IndicatorHlineStyles): Promise<void> {
    const all = await this.loadHlineAll();
    all[indicatorKey] = styles;
    this.hlineCache = all;
    await this.storage.set(this.HLINE_STORAGE_KEY, all);
  }

  randomColor(): string {
    const HUE_RANGES: [number, number][] = [
      [15, 130],
      [150, 345],
    ];
    const totalSpan = HUE_RANGES.reduce((sum, [from, to]) => sum + (to - from), 0);
    let pick = Math.random() * totalSpan;
    let hue = HUE_RANGES[0][0];
    for (const [from, to] of HUE_RANGES) {
      const span = to - from;
      if (pick <= span) {
        hue = from + pick;
        break;
      }
      pick -= span;
    }
    return this.hslToHex(hue, 70, 55);
  }

  private hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (n: number) =>
      Math.round(255 * f(n))
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
  }

  private async loadAll(): Promise<ColorMap> {
    if (this.cache) return this.cache;
    this.cache = (await this.storage.get<ColorMap>(this.STORAGE_KEY)) ?? {};
    return this.cache;
  }

  private async loadSubFieldAll(): Promise<SubFieldStyleMap> {
    if (this.subFieldCache) return this.subFieldCache;
    this.subFieldCache =
      (await this.storage.get<SubFieldStyleMap>(this.SUBFIELD_STORAGE_KEY)) ?? {};
    return this.subFieldCache;
  }

  private async loadHlineAll(): Promise<HlineStyleMap> {
    if (this.hlineCache) return this.hlineCache;
    this.hlineCache = (await this.storage.get<HlineStyleMap>(this.HLINE_STORAGE_KEY)) ?? {};
    return this.hlineCache;
  }
}
