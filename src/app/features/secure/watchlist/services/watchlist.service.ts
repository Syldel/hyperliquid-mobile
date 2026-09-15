import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import { StorageService } from '@storage/storage.service';
import { CandleInterval } from '@syldel/hl-shared-types';
import { filter, firstValueFrom } from 'rxjs';
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

  /**
   * Adresse du wallet une fois la session restaurée.
   *
   * `currentAddress()` vaut `null` dans deux situations qui n'ont rien à voir :
   * la restauration n'a pas encore eu lieu, ou personne n'est connecté. Les
   * confondre faisait répondre « aucune paire » pendant le battement qui suit
   * une reprise de session. Même raisonnement, et même correctif, que
   * `StrategyLibraryService` — les deux partagent ce patron de stockage.
   */
  private async walletAddress(): Promise<string | null> {
    await firstValueFrom(this.auth.ready$.pipe(filter(Boolean)));
    return this.auth.currentAddress();
  }

  async load(): Promise<WatchlistItem[]> {
    const address = await this.walletAddress();
    const all = (await this.storage.get<WatchlistStorage>(this.STORAGE_KEY)) ?? {};

    // Pas de wallet : pas de watchlist à montrer, et surtout pas celle du
    // wallet précédent — sortir sans toucher à `_items` la laissait affichée.
    if (!address) {
      this._items.set([]);
      return [];
    }

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

  /**
   * Écrit la watchlist du wallet courant, ou **lève**.
   *
   * Sortir en silence laissait `add` rendre la main comme si la paire avait
   * été ajoutée — la page annonçait alors « BTC added to watchlist » sur une
   * écriture qui n'avait pas eu lieu. La watchlist ne porte pas de règles de
   * trading, mais elle porte les stratégies attachées à chaque chart : la
   * perdre sans un mot, c'est rouvrir l'app devant un chart qu'on croyait
   * configuré.
   *
   * `_items` n'est mis à jour qu'**après** l'écriture : c'est cette liste que
   * le chart relit pour savoir ce qui lui est attaché.
   */
  private async persist(items: WatchlistItem[]): Promise<void> {
    const address = await this.walletAddress();
    if (!address) {
      throw new Error('No wallet selected: the watchlist has nowhere to write.');
    }

    const all = (await this.storage.get<WatchlistStorage>(this.STORAGE_KEY)) ?? {};
    all[address] = items;

    await this.storage.set(this.STORAGE_KEY, all);
    this._items.set(items);
  }
}
