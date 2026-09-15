import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { StorageService } from '@storage/storage.service';
import { BehaviorSubject } from 'rxjs';
import { StrategyLibraryService } from '../../strategies/services/strategy-library.service';
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
