import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { HLOrderStatusData } from '@syldel/hl-shared-types';
import { of, Subject } from 'rxjs';
import { AccountActivityService } from './account-activity.service';
import { HyperliquidCacheService } from './hyperliquid-cache.service';
import { HyperliquidInfoService } from './hyperliquid-info.service';

/**
 * ============================================================================
 * LE DEX OÙ LIRE LES ORDRES DU COIN SÉLECTIONNÉ
 *
 * `selectCoin` règle `config.dex`, donc la lecture des ordres ouverts. Il découpait le nom sur `:` et
 * rendait `''` pour tout ce qui n'avait pas de préfixe — un nom douteux compris. Il lit maintenant
 * `openOrdersDexOf` (règle des types partagés) : le dex d'un perp, `''` pour un spot (« Spot open orders are
 * only included with the first perp dex », doc « Info endpoint », relue le 2026-10-19), et **aucun** pour un
 * nom que la règle ne sait pas classer — la sélection est alors refusée, bruyamment.
 * ============================================================================
 */
describe('HyperliquidCacheService — selecting a coin', () => {
  let service: HyperliquidCacheService;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HyperliquidInfoService,
          useValue: {
            getFrontendOpenOrders: () => of([]),
            getHistoricalOrders: () => of([]),
            getUserFillsByTime: () => of([]),
          },
        },
        { provide: AuthService, useValue: { currentAddress: signal('0xA') } },
      ],
    });
    service = TestBed.inject(HyperliquidCacheService);
  });

  afterEach(() => consoleError.mockRestore());

  describe.each([
    ['selectCoin', (coin: string) => service.selectCoin(coin)],
    ['selectCoinWithConfig', (coin: string) => service.selectCoinWithConfig(coin, {})],
  ])('%s', (_, select) => {
    it.each([
      ['BTC', ''],
      ['xyz:MU', 'xyz'],
      ['vntl:ROBOT', 'vntl'],
    ])('reads the dex of the perp %s: "%s"', (coin, dex) => {
      select(coin);

      expect(service.selectedCoin()).toBe(coin);
      expect(service.config().dex).toBe(dex);
    });

    // Un spot se lit avec le dex vide, qui est celui où l'exchange renvoie ses ordres : documenté.
    it.each(['@107', 'PURR/USDC', 'HYPE/USDC'])(
      'reads the main dex for the spot pair %s',
      (coin) => {
        service.config.update((c) => ({ ...c, dex: 'xyz' }));

        select(coin);

        expect(service.selectedCoin()).toBe(coin);
        expect(service.config().dex).toBe('');
      },
    );

    // Le doute n'est pas une réponse : un nom non classé n'est ni sélectionné ni lu sur le dex principal.
    it.each([':BTC', 'xyz:', '', '#10', '+10'])(
      'refuses "%s" loudly, and changes nothing',
      (coin) => {
        service.config.update((c) => ({ ...c, dex: 'xyz' }));

        select(coin);

        expect(service.selectedCoin()).toBeNull();
        expect(service.config().dex).toBe('xyz');
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('not selected'));
      },
    );
  });

  // Où l'exchange renvoie les ordres d'un outcome n'a pas été mesuré : ni dex principal par défaut, ni deviné.
  it('calls an outcome market by its name when it refuses it', () => {
    service.selectCoin('#10');

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"#10" is an outcome market (HIP-4)'),
    );
  });

  it('keeps the lookback it was given along with the dex, in one write', () => {
    service.selectCoinWithConfig('xyz:MU', { fillsLookbackDays: 7 });

    expect(service.config()).toMatchObject({ dex: 'xyz', fillsLookbackDays: 7 });
  });
});

/**
 * ============================================================================
 * QUAND LES ORDRES DU CHART SONT RELUS, ET CE QUE L'ÉCRAN EN VOIT
 *
 * Trois défauts constatés le 2026-11-15, un bloc chacun : une écriture au compte ne relisait rien, un
 * changement de compte non plus (le chart de B portait les ordres de A), et une lecture en échec faisait
 * lever `value()` — un chart sans lignes, qui se lisait « aucun ordre ».
 *
 * Le double d'`HyperliquidInfoService` ne rend que des formes que le vrai rend : une liste, ou une
 * erreur HTTP.
 * ============================================================================
 */
describe('HyperliquidCacheService — reading the account', () => {
  const order = (oid: number, coin = 'BTC') =>
    ({
      order: { oid, coin },
      status: 'open',
      statusTimestamp: oid,
    }) as unknown as HLOrderStatusData;

  let address: ReturnType<typeof signal<string | null>>;
  let historical: Subject<HLOrderStatusData[]>[];
  let historicalCalls: (string | null)[];
  let openOrdersCalls: number;
  let service: HyperliquidCacheService;
  let activity: AccountActivityService;

  /** Laisse les effets et les chargeurs de ressources s'exécuter. */
  const settle = async () => {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  /** Répond au dernier appel d'historique en attente. */
  const answerHistorical = async (orders: HLOrderStatusData[]) => {
    const pending = historical.at(-1)!;
    pending.next(orders);
    pending.complete();
    await settle();
  };

  beforeEach(async () => {
    address = signal<string | null>('0xA');
    historical = [];
    historicalCalls = [];
    openOrdersCalls = 0;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: HyperliquidInfoService,
          useValue: {
            getFrontendOpenOrders: () => {
              openOrdersCalls++;
              return of([]);
            },
            getHistoricalOrders: () => {
              // L'adresse lue au moment de l'appel, comme le vrai service.
              historicalCalls.push(address());
              const pending = new Subject<HLOrderStatusData[]>();
              historical.push(pending);
              return pending;
            },
            getUserFillsByTime: () => of([]),
          },
        },
        { provide: AuthService, useValue: { currentAddress: address } },
      ],
    });
    service = TestBed.inject(HyperliquidCacheService);
    activity = TestBed.inject(AccountActivityService);
    service.selectCoin('BTC');
    await settle();
  });

  describe('a write to the account', () => {
    it('reads the orders again at once, without waiting for the minute', async () => {
      await answerHistorical([order(1)]);
      service.reloadAll(); // dans la minute : retenu
      await settle();
      expect(historical).toHaveLength(1);

      activity.record('modify');
      await settle();

      expect(historical).toHaveLength(2);
      await answerHistorical([order(2)]);
      expect(service.coinSnapshot()?.historicalOrders).toEqual([order(2)]);
    });

    it('reads every source again, not only the orders', async () => {
      const before = openOrdersCalls;

      activity.record('cancel');
      await settle();

      expect(openOrdersCalls).toBe(before + 1);
    });

    // Le cache se construit en lisant : sans écriture, rien d'autre ne part.
    it('reads once at construction, and not again without a write', () => {
      expect(historical).toHaveLength(1);
    });
  });

  describe('a reload', () => {
    // La valeur restait vide pendant le chargement quand un compteur changeait les paramètres : les
    // lignes d'ordres disparaissaient du chart à chaque relecture.
    it('keeps the orders on screen until the new ones arrive', async () => {
      await answerHistorical([order(1)]);

      service.reloadAll(true);
      await settle();

      expect(historical).toHaveLength(2);
      expect(service.coinSnapshot()?.historicalOrders).toEqual([order(1)]);
    });

    it('is held back within the minute unless forced', async () => {
      await answerHistorical([order(1)]);

      service.reloadAll();
      await settle();
      expect(historical).toHaveLength(1);

      service.reloadAll(true);
      await settle();
      expect(historical).toHaveLength(2);
    });
  });

  describe('switching account', () => {
    it('reads the orders of the new account, whatever the minute says', async () => {
      await answerHistorical([order(1)]);

      address.set('0xB');
      await settle();

      expect(historicalCalls).toEqual(['0xA', '0xB']);
    });

    // Pendant la lecture du compte B, rien du compte A ne reste à l'écran.
    it('never shows the orders of the previous account', async () => {
      await answerHistorical([order(1)]);

      address.set('0xB');
      await settle();

      expect(service.coinSnapshot()?.historicalOrders).toEqual([]);
    });

    it('reads nothing without an account', async () => {
      address.set(null);
      await settle();

      expect(historicalCalls).toEqual(['0xA']);
      expect(service.failures()).toEqual([]);
    });
  });

  describe('a failed read', () => {
    it('says which source failed, instead of throwing', async () => {
      historical.at(-1)!.error(new Error('HTTP 429'));
      await settle();

      expect(service.failures()).toEqual(['historicalOrders']);
      // `value()` lève sur une ressource en erreur : le snapshot, lui, reste lisible.
      expect(service.coinSnapshot()?.historicalOrders).toEqual([]);
    });

    // Une liste vide est une réponse : elle ne se signale pas comme une panne.
    it('does not report an empty answer as a failure', async () => {
      await answerHistorical([]);

      expect(service.failures()).toEqual([]);
    });

    it('stops reporting the failure once a reload succeeds', async () => {
      historical.at(-1)!.error(new Error('HTTP 429'));
      await settle();

      service.reloadAll(true);
      await settle();
      await answerHistorical([order(3)]);

      expect(service.failures()).toEqual([]);
      expect(service.coinSnapshot()?.historicalOrders).toEqual([order(3)]);
    });
  });
});
