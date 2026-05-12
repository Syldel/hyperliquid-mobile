import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import { StorageService } from '@storage/storage.service';
import { CandleInterval } from '@syldel/hl-shared-types';
import { WatchlistItem } from '../models/watchlist-item.model';

type WatchlistStorage = Record<string, WatchlistItem[]>;

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  private _items = signal<WatchlistItem[]>([]);
  readonly items = this._items.asReadonly();

  private readonly STORAGE_KEY = 'watchlist_items';

  async load(): Promise<WatchlistItem[]> {
    const all = (await this.storage.get<WatchlistStorage>(this.STORAGE_KEY)) ?? {};
    const address = this.auth.currentAddress();
    if (!address) return [];
    const items = all[address] ?? [];
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
    const all = (await this.storage.get<WatchlistStorage>(this.STORAGE_KEY)) ?? {};
    const address = this.auth.currentAddress();
    if (!address) return;
    all[address] = items;
    this._items.set(items);
    await this.storage.set(this.STORAGE_KEY, all);
  }
}
