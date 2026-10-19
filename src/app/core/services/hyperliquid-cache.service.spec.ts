import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
    it.each([':BTC', 'xyz:', ''])('refuses "%s" loudly, and changes nothing', (coin) => {
      service.config.update((c) => ({ ...c, dex: 'xyz' }));

      select(coin);

      expect(service.selectedCoin()).toBeNull();
      expect(service.config().dex).toBe('xyz');
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('not selected'));
    });
  });

  it('keeps the lookback it was given along with the dex, in one write', () => {
    service.selectCoinWithConfig('xyz:MU', { fillsLookbackDays: 7 });

    expect(service.config()).toMatchObject({ dex: 'xyz', fillsLookbackDays: 7 });
  });
});
