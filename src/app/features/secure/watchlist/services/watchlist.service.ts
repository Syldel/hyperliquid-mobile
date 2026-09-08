import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import { StorageService } from '@storage/storage.service';
import { CandleInterval } from '@syldel/hl-shared-types';
import { migrateLegacyWatchlistStrategies } from '../../strategies/domain/legacy-strategy-migration.util';
import { StrategyLibraryService } from '../../strategies/services/strategy-library.service';
import { WatchlistItem } from '../models/watchlist-item.model';

type WatchlistStorage = Record<string, WatchlistItem[]>;

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly library = inject(StrategyLibraryService);

  private _items = signal<WatchlistItem[]>([]);
  readonly items = this._items.asReadonly();

  private readonly STORAGE_KEY = 'watchlist_items';

  async load(): Promise<WatchlistItem[]> {
    const all = (await this.storage.get<WatchlistStorage>(this.STORAGE_KEY)) ?? {};
    const address = this.auth.currentAddress();
    if (!address) return [];
    const stored = all[address] ?? [];

    // Reprise ponctuelle des charts qui portaient encore une copie complète de
    // leur stratégie. Sans effet une fois faite (le champ a disparu), donc sans
    // inconvénient à la retenter à chaque chargement. Les documents récupérés
    // sont écrits AVANT les éléments migrés : une référence ne doit jamais
    // pointer, même brièvement, sur une stratégie absente de la bibliothèque.
    const migration = migrateLegacyWatchlistStrategies(stored);
    if (migration.changed) {
      await this.library.load();
      await this.library.importMissing(migration.recovered);
      await this.persist(migration.items);
      return migration.items;
    }

    this._items.set(stored);
    return stored;
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
