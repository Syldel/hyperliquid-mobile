import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { StorageService } from '@storage/storage.service';
import { BehaviorSubject } from 'rxjs';
import { StrategyLibraryService } from '../../strategies/services/strategy-library.service';
import type { WatchlistItem } from '../models/watchlist-item.model';
import { WatchlistService } from './watchlist.service';

/**
 * Même patron de stockage que `StrategyLibraryService`, et donc les mêmes
 * pièges : un `Record<address, T[]>` dans un seul enregistrement Preferences.
 *
 * Ce que ces tests fixent, c'est qu'une écriture qui n'a pas lieu se dise. La
 * watchlist ne porte pas de règles de trading, mais elle porte les stratégies
 * attachées à un chart : la perdre en silence, c'est rouvrir l'app devant un
 * chart qu'on croyait configuré.
 */
class StorageStub {
  readonly store = new Map<string, unknown>();
  failOnSet = false;

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (this.failOnSet) throw new Error('storage full');
    this.store.set(key, value);
  }
}

const WALLET_A = '0xaaa';

describe('WatchlistService', () => {
  let service: WatchlistService;
  let storage: StorageStub;
  let address: string | null;
  let ready$: BehaviorSubject<boolean>;

  beforeEach(() => {
    storage = new StorageStub();
    address = WALLET_A;
    ready$ = new BehaviorSubject(true);

    TestBed.configureTestingModule({
      providers: [
        WatchlistService,
        { provide: StorageService, useValue: storage },
        { provide: AuthService, useValue: { currentAddress: () => address, ready$ } },
        // La migration n'est pas le sujet ici : elle ne se déclenche que sur
        // un élément portant encore une copie complète de sa stratégie.
        {
          provide: StrategyLibraryService,
          useValue: { load: async () => [], importMissing: async () => [] },
        },
      ],
    });

    service = TestBed.inject(WatchlistService);
  });

  it('adds a pair and reloads it', async () => {
    await service.add('BTC', '1h');

    expect(service.items().map((i) => i.coin)).toEqual(['BTC']);
    expect((await service.load()).map((i) => i.coin)).toEqual(['BTC']);
  });

  /**
   * `currentAddress()` vaut `null` tant que `restoreSession` n'a pas rendu la
   * main. Répondre « aucune paire » à ce moment-là est un mensonge qui
   * ressemble à une réponse : la watchlist paraissait vide le temps d'un
   * battement, juste après une reprise de session.
   */
  it('waits for the session to be restored before answering', async () => {
    await service.add('BTC', '1h');

    ready$.next(false);
    address = null;

    let answered = false;
    const pending = service.load().then((items) => {
      answered = true;
      return items;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answered).toBe(false);

    address = WALLET_A;
    ready$.next(true);

    expect((await pending).map((i) => i.coin)).toEqual(['BTC']);
  });

  // Session restaurée et toujours pas de wallet : il n'y a pas de watchlist à
  // montrer — surtout pas celle du wallet précédent.
  it('drops the pairs of the previous wallet when none is selected', async () => {
    await service.add('BTC', '1h');
    expect(service.items()).toHaveLength(1);

    address = null;

    expect(await service.load()).toEqual([]);
    expect(service.items()).toEqual([]);
  });

  it('refuses to write when no wallet is selected, rather than pretending', async () => {
    address = null;

    await expect(service.add('BTC', '1h')).rejects.toThrow(/wallet/i);
    expect(storage.store.size).toBe(0);
  });

  /**
   * La liste en mémoire ne doit pas annoncer un changement que le stockage n'a
   * pas pris : c'est elle que le chart relit pour savoir ce qui lui est
   * attaché.
   */
  it('does not report in memory a change it could not persist', async () => {
    await service.add('BTC', '1h');
    storage.failOnSet = true;

    await expect(service.add('ETH', '1h')).rejects.toThrow();

    expect(service.items().map((i) => i.coin)).toEqual(['BTC']);
  });

  it('keeps a strategy attached to the right pair when updating', async () => {
    await service.add('BTC', '1h');
    await service.add('ETH', '1h');

    await service.update('ETH', { strategyRefs: [{ strategyId: 'st_1', visible: true }] });

    expect(service.getByCoin('BTC')?.strategyRefs).toBeUndefined();
    expect(service.getByCoin('ETH')?.strategyRefs).toEqual([{ strategyId: 'st_1', visible: true }]);
  });

  it('leaves other wallets untouched when persisting', async () => {
    await service.add('BTC', '1h');

    address = '0xbbb';
    await service.load();
    await service.add('SOL', '1h');

    address = WALLET_A;
    expect((await service.load()).map((i) => i.coin)).toEqual(['BTC']);
  });
});

/**
 * Ce que le premier bloc ne fixe pas : la normalisation d'un nom, le doublon,
 * la suppression, et surtout l'**ordre** de la reprise des anciens charts.
 */
describe('WatchlistService — names, removal and legacy charts', () => {
  let service: WatchlistService;
  let storage: StorageStub;
  let order: string[];

  const item = (coin: string, extra: Partial<WatchlistItem> = {}): WatchlistItem => ({
    coin,
    interval: '1h',
    addedAt: 1,
    ...extra,
  });

  beforeEach(() => {
    storage = new StorageStub();
    order = [];
    const set = storage.set.bind(storage);
    storage.set = async (key, value) => {
      order.push('storage.set');
      return set(key, value);
    };

    TestBed.configureTestingModule({
      providers: [
        WatchlistService,
        { provide: StorageService, useValue: storage },
        {
          provide: AuthService,
          useValue: { currentAddress: () => WALLET_A, ready$: new BehaviorSubject(true) },
        },
        {
          provide: StrategyLibraryService,
          useValue: {
            load: async () => [],
            importMissing: async (docs: { id: string }[]) => {
              order.push(`library.importMissing(${docs.map((d) => d.id)})`);
              return [];
            },
          },
        },
      ],
    });
    service = TestBed.inject(WatchlistService);
  });

  it('trims the name, so " BTC " and "BTC" are the same pair', async () => {
    await service.add(' BTC ');
    await service.add('BTC');

    expect(service.items().map((i) => i.coin)).toEqual(['BTC']);
  });

  it('defaults to the 1h interval', async () => {
    await service.add('BTC');

    expect(service.getByCoin('BTC')?.interval).toBe('1h');
  });

  it('does not add a pair twice, keeps the first interval and does not rewrite the storage', async () => {
    await service.add('BTC', '1h');
    order.length = 0;

    await service.add('BTC', '4h');

    expect(service.getByCoin('BTC')?.interval).toBe('1h');
    expect(order).toEqual([]);
  });

  it('keeps a HIP-3 market name whole', async () => {
    await service.add('xyz:BRENTOIL');

    expect(service.getByCoin('xyz:BRENTOIL')).toBeDefined();
  });

  it('removes only the named pair, in memory and in the storage', async () => {
    await service.add('BTC');
    await service.add('ETH');

    await service.remove('BTC');

    expect(service.items().map((i) => i.coin)).toEqual(['ETH']);
    const stored = storage.store.get('watchlist_items') as Record<string, WatchlistItem[]>;
    expect(stored[WALLET_A].map((i) => i.coin)).toEqual(['ETH']);
  });

  it('changes nothing when asked to update a pair that is not there', async () => {
    await service.add('BTC');

    await service.update('SOL', { interval: '1d' });

    expect(service.items().map((i) => i.coin)).toEqual(['BTC']);
    expect(service.getByCoin('BTC')?.interval).toBe('1h');
  });

  describe('a chart that still carries a full copy of its strategy', () => {
    const legacy = {
      ...item('BTC'),
      activeStrategy: {
        id: 's1',
        name: 'Old',
        rules: { long: { entry: { type: 'logical', operator: 'AND', conditions: [] } } },
      },
    } as unknown as WatchlistItem;

    // Une référence ne doit jamais pointer, même brièvement, sur une stratégie
    // absente de la bibliothèque.
    it('writes the recovered document to the library before the migrated item', async () => {
      storage.store.set('watchlist_items', { [WALLET_A]: [legacy] });

      const items = await service.load();

      expect(order).toEqual(['library.importMissing(s1)', 'storage.set']);
      expect(items[0].strategyRefs).toEqual([{ strategyId: 's1', visible: true }]);
      expect('activeStrategy' in items[0]).toBe(false);
    });

    it('writes nothing when there is nothing to migrate', async () => {
      storage.store.set('watchlist_items', { [WALLET_A]: [item('BTC')] });

      await service.load();

      expect(order).toEqual([]);
    });
  });
});
