import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { CandleInterval } from '@syldel/hl-shared-types';
import { WatchlistItem } from '../models/watchlist-item.model';

const STORAGE_KEY = 'watchlist_items';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private _items = signal<WatchlistItem[]>([]);
  readonly items = this._items.asReadonly();

  async load(): Promise<WatchlistItem[]> {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    const items: WatchlistItem[] = value ? JSON.parse(value) : [];
    this._items.set(items);
    return items;
  }

  async add(coin: string, interval: CandleInterval = '1h'): Promise<void> {
    const normalized = coin.trim();
    if (this._items().some((i) => i.coin === normalized)) return;

    const item: WatchlistItem = {
      coin: normalized,
      interval,
      addedAt: Date.now(),
    };
    await this.persist([...this._items(), item]);
  }

  async remove(coin: string): Promise<void> {
    await this.persist(this._items().filter((i) => i.coin !== coin));
  }

  async update(
    coin: string,
    changes: Partial<Omit<WatchlistItem, 'coin' | 'addedAt'>>,
  ): Promise<void> {
    await this.persist(this._items().map((i) => (i.coin === coin ? { ...i, ...changes } : i)));
  }

  getByCoin(coin: string): WatchlistItem | undefined {
    return this._items().find((i) => i.coin === coin);
  }

  private async persist(items: WatchlistItem[]): Promise<void> {
    this._items.set(items);
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(items) });
  }
}
