import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '@services/config.service';
import { MarketMetaError, type MarketMeta } from '@utils/market-meta.util';
import { HyperliquidMarketService } from './hyperliquid-market.service';

/**
 * ============================================================================
 * LA GRILLE D'UN MARCHÉ, DEPUIS LE RÉSEAU : LA SIENNE, OU UNE ERREUR QUI LE DIT
 *
 * `getMarketMeta` remplace la recherche par sous-chaîne du formulaire d'ordre (voir
 * `market-meta.util.ts` : 38 perps et les 334 paires spot lisaient les données d'un autre). Ces tests
 * éprouvent ce que le service y ajoute : quelle méta il interroge, et ce qu'il fait d'un marché absent,
 * d'un nom douteux et d'une panne de transport. La lecture exacte, elle, est testée dans
 * `market-meta.util.spec.ts`.
 *
 * Valeurs relevées le 2026-10-19 : ETH `szDecimals` 4, ETHFI 1 ; USDC 8, PURR 0, HFUN 2. Les index de
 * jetons hors USDC et PURR sont illustratifs.
 * ============================================================================
 */
describe('HyperliquidMarketService.getMarketMeta', () => {
  let service: HyperliquidMarketService;
  let http: HttpTestingController;

  const MAIN_META = {
    universe: [
      { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
      { name: 'ETHFI', szDecimals: 1, maxLeverage: 5 },
    ],
  };
  const SPOT_META = {
    tokens: [
      { index: 0, name: 'USDC', szDecimals: 8 },
      { index: 1, name: 'PURR', szDecimals: 0 },
      { index: 2, name: 'HFUN', szDecimals: 2 },
      { index: 142, name: 'UBTC', szDecimals: 5 },
    ],
    universe: [
      { name: 'PURR/USDC', tokens: [1, 0], index: 0, isCanonical: true },
      { name: '@1', tokens: [2, 0], index: 1, isCanonical: false },
      { name: '@142', tokens: [142, 0], index: 142, isCanonical: false },
    ],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        HyperliquidMarketService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { hyperliquidPublicUrl: 'http://hl.test' } },
      ],
    });
    service = TestBed.inject(HyperliquidMarketService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Lit le premier résultat ou la première erreur, de façon synchrone. */
  function settle(coin: string): { value?: MarketMeta; error?: unknown } {
    const result: { value?: MarketMeta; error?: unknown } = {};
    service.getMarketMeta(coin).subscribe({
      next: (value) => (result.value = value),
      error: (error) => (result.error = error),
    });
    return result;
  }

  describe('a perp', () => {
    it('reads the main dex meta for a market without a prefix, and returns its own grid', () => {
      const result = settle('ETHFI');

      const request = http.expectOne('http://hl.test/info');
      expect(request.request.body).toEqual({ type: 'meta' });
      request.flush(MAIN_META);

      // ETHFI, pas ETH : l'ancienne règle lui donnait `szDecimals` 4 et un levier de 25.
      expect(result.value).toEqual({ kind: 'perp', szDecimals: 1, maxLeverage: 5 });
    });

    it('reads the meta of the dex a HIP-3 market names in its prefix', () => {
      const result = settle('xyz:MU');

      const request = http.expectOne('http://hl.test/info');
      expect(request.request.body).toEqual({ type: 'meta', dex: 'xyz' });
      request.flush({ universe: [{ name: 'xyz:MU', szDecimals: 3, maxLeverage: 10 }] });

      expect(result.value).toEqual({ kind: 'perp', szDecimals: 3, maxLeverage: 10 });
    });

    it('does not ask the network twice for the same dex', () => {
      settle('ETH');
      http.expectOne('http://hl.test/info').flush(MAIN_META);

      const second = settle('ETHFI');

      http.expectNone('http://hl.test/info');
      expect(second.value).toMatchObject({ szDecimals: 1 });
    });

    it('refuses a market that is not in its dex meta, with a typed error', () => {
      const result = settle('ETHX');
      http.expectOne('http://hl.test/info').flush(MAIN_META);

      expect(result.value).toBeUndefined();
      expect(result.error).toBeInstanceOf(MarketMetaError);
      expect((result.error as MarketMetaError).code).toBe('not-found');
    });

    it('does not turn a transport failure into a market error: the caller must tell them apart', () => {
      const result = settle('ETH');
      http
        .expectOne('http://hl.test/info')
        .flush('boom', { status: 500, statusText: 'Server Error' });

      expect(result.error).not.toBeInstanceOf(MarketMetaError);
      expect(result.error).toMatchObject({ status: 500 });
    });
  });

  describe('a name it cannot classify', () => {
    it.each([':BTC', 'xyz:', ''])('refuses "%s" without asking the network', (name) => {
      const result = settle(name);

      http.expectNone('http://hl.test/info');
      expect((result.error as MarketMetaError).code).toBe('invalid-name');
      expect((result.error as MarketMetaError).message).toContain('is not a valid market name');
    });
  });

  describe('a spot pair', () => {
    /** La paire se lit par son nom d'affichage ou de protocole, toujours sur le jeton de BASE. */
    it.each([
      ['PURR/USDC', 0],
      ['@1', 2],
      ['HFUN/USDC', 2],
      // Hyperunit : la paire `UBTC/USDC` s'affiche `BTC/USDC`.
      ['BTC/USDC', 5],
      ['@142', 5],
    ])('reads %s on the grid of its base token (%i decimals), not USDC (8)', (name, szDecimals) => {
      const result = settle(name);

      http.expectOne('http://hl.test/info').flush(SPOT_META);

      expect(result.value).toEqual({ kind: 'spot', szDecimals });
    });

    it('asks the spot meta once for all the names it resolves', () => {
      settle('PURR/USDC');
      http.expectOne('http://hl.test/info').flush(SPOT_META);

      const second = settle('@1');

      http.expectNone('http://hl.test/info');
      expect(second.value).toEqual({ kind: 'spot', szDecimals: 2 });
    });

    it('refuses a spot pair it does not know, with a typed error', () => {
      const result = settle('NOPE/USDC');
      http.expectOne('http://hl.test/info').flush(SPOT_META);

      expect(result.error).toBeInstanceOf(MarketMetaError);
      expect((result.error as MarketMetaError).code).toBe('not-found');
    });
  });
});
