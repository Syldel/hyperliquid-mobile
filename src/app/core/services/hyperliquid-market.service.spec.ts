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

  // HIP-4 : connu de la règle, mais l'app ne le négocie pas. Un refus qui le dit, pas « nom invalide ».
  describe('an outcome market', () => {
    it.each(['#10', '+10', '#142000'])(
      'refuses %s as unsupported, without asking the network',
      (name) => {
        const result = settle(name);

        http.expectNone('http://hl.test/info');
        expect(result.error).toBeInstanceOf(MarketMetaError);
        expect((result.error as MarketMetaError).code).toBe('unsupported');
        expect((result.error as MarketMetaError).message).toContain('is an outcome market (HIP-4)');
      },
    );
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

  /**
   * L'IDENTIFIANT D'ACTIF QUE PORTENT `order` ET `cancel`.
   *
   * Source : doc « Asset IDs », relue le 2026-10-19 : spot `10000 + spotInfo["index"]` (PURR/USDC → 10000),
   * perp de builder `100000 + perp_dex_index * 10000 + index_in_meta` (exemple de la doc : `test:ABC`, dex 1,
   * index 0 → 110000), perp natif son index dans `meta`.
   *
   * Défaut corrigé : la branche spot se décidait par `includes('/')`. Sous leur nom BRUT (`@N`, ce que
   * l'exchange renvoie dans les ordres), 333 des 334 paires spot tombaient dans la branche perp.
   */
  describe('getAssetIndex', () => {
    const PERP_DEXS = [null, { name: 'test' }, { name: 'xyz' }];

    function indexOf(coin: string): { value?: number; error?: unknown } {
      const result: { value?: number; error?: unknown } = {};
      service.getAssetIndex(coin).subscribe({
        next: (value) => (result.value = value),
        error: (error) => (result.error = error),
      });
      return result;
    }

    describe('a spot pair', () => {
      it.each([
        ['PURR/USDC', 10000],
        ['@1', 10001],
        ['@142', 10142],
      ])('gives %s the asset id %i', (name, id) => {
        const result = indexOf(name);
        http.expectOne('http://hl.test/info').flush(SPOT_META);

        expect(result.value).toBe(id);
      });

      // Le défaut : `@1` n'est pas une paire « avec barre oblique » et partait dans la branche perp, qui
      // répondait « Perp asset not found ». On n'interroge JAMAIS la méta perp pour un spot.
      it('reads a raw @N name as a spot and never asks the perp meta', () => {
        const result = indexOf('@1');

        const request = http.expectOne('http://hl.test/info');
        expect(request.request.body).toEqual({ type: 'spotMeta' });
        request.flush(SPOT_META);

        expect(result.value).toBe(10001);
        expect(result.error).toBeUndefined();
      });

      it.each([
        // Le nom officiel d'une paire non canonique, et le nom d'affichage hyperunit (`UBTC` → `BTC`).
        ['HFUN/USDC', 10001],
        ['BTC/USDC', 10142],
      ])('also resolves the display name %s', (name, id) => {
        const result = indexOf(name);
        http.expectOne('http://hl.test/info').flush(SPOT_META);

        expect(result.value).toBe(id);
      });

      it('refuses a spot pair that does not exist, with the coin in the message', () => {
        const result = indexOf('@999');
        http.expectOne('http://hl.test/info').flush(SPOT_META);

        expect(result.value).toBeUndefined();
        expect((result.error as Error).message).toBe('Spot asset not found for coin: @999');
      });
    });

    describe('a builder-deployed perp', () => {
      it('gives test:ABC 110000, the example of the documentation', () => {
        const result = indexOf('test:ABC');

        http.expectOne((r) => r.body.type === 'perpDexs').flush(PERP_DEXS);
        http
          .expectOne((r) => r.body.type === 'meta' && r.body.dex === 'test')
          .flush({ universe: [{ name: 'test:ABC' }] });

        expect(result.value).toBe(110000);
      });

      it('adds the market index to the dex slot: xyz:MU is the second of the third dex', () => {
        const result = indexOf('xyz:MU');

        http.expectOne((r) => r.body.type === 'perpDexs').flush(PERP_DEXS);
        http
          .expectOne((r) => r.body.type === 'meta' && r.body.dex === 'xyz')
          .flush({ universe: [{ name: 'xyz:AAA' }, { name: 'xyz:MU' }] });

        // 100000 + 2 * 10000 + 1
        expect(result.value).toBe(120001);
      });

      it('refuses a dex that is not deployed', () => {
        const result = indexOf('nope:ABC');
        http.expectOne((r) => r.body.type === 'perpDexs').flush(PERP_DEXS);

        expect((result.error as Error).message).toBe('PerpDex not found for dex: nope');
      });

      it('refuses a market that is not in its dex meta', () => {
        const result = indexOf('xyz:ZZZ');
        http.expectOne((r) => r.body.type === 'perpDexs').flush(PERP_DEXS);
        http
          .expectOne((r) => r.body.type === 'meta' && r.body.dex === 'xyz')
          .flush({ universe: [{ name: 'xyz:MU' }] });

        expect((result.error as Error).message).toBe(
          'Asset not found in perpDex meta for coin: xyz:ZZZ',
        );
      });
    });

    describe('a main-dex perp', () => {
      it('gives its index in the meta', () => {
        const result = indexOf('ETHFI');
        http.expectOne((r) => r.body.type === 'meta').flush(MAIN_META);

        expect(result.value).toBe(1);
      });

      it('refuses a perp that is not in the meta', () => {
        const result = indexOf('ETHX');
        http.expectOne((r) => r.body.type === 'meta').flush(MAIN_META);

        expect((result.error as Error).message).toBe('Perp asset not found for coin: ETHX');
      });
    });

    // Un outcome a un identifiant (`100_000_000 + encodage`), mais l'app ne le négocie ni ne l'annule : le
    // refus le dit, au lieu de passer pour un nom illisible — c'est ce message qu'affiche le toast d'annulation.
    it.each(['#10', '+10', '#142000'])('refuses the outcome market %s, and says so', (name) => {
      const result = indexOf(name);

      http.expectNone('http://hl.test/info');
      expect((result.error as Error).message).toContain('is an outcome market (HIP-4)');
      expect((result.error as Error).message).not.toContain('can classify');
      // Un refus sans issue laisse un ordre ouvert que l'utilisateur ne sait pas où retirer.
      expect((result.error as Error).message).toContain('use the Hyperliquid web app');
    });

    // Le doute n'est pas une réponse : ni deviné perp du dex principal, ni lu.
    it.each([':BTC', 'xyz:', ''])('refuses "%s" without asking the network', (name) => {
      const result = indexOf(name);

      http.expectNone('http://hl.test/info');
      expect((result.error as Error).message).toContain('not a market name this app can classify');
    });
  });

  describe('the spot names', () => {
    function names(): string[] {
      let value: string[] = [];
      service.getSpotNames().subscribe((v) => (value = v));
      http.expectOne('http://hl.test/info').flush(SPOT_META);
      return value;
    }

    // Les noms de protocole sont les valeurs de `protocolMap`, dans l'ordre de `spotMeta` : un nom par
    // paire, jamais deux (le nom officiel d'une paire n'est qu'une clé de plus de la même paire).
    it('lists one display name per pair, in the order of spotMeta', () => {
      expect(names()).toEqual(['PURR/USDC', 'HFUN/USDC', 'BTC/USDC']);
    });

    it('resolves a raw name to its display name, and leaves anything else alone', () => {
      const resolved: Record<string, string> = {};
      // La première résolution charge `spotMeta` ; les suivantes la lisent en cache. (Le service ne regroupe
      // pas les requêtes en vol : des résolutions simultanées en feraient autant que de noms.)
      service.resolveCoinName('@1').subscribe((name) => (resolved['@1'] = name));
      http.expectOne('http://hl.test/info').flush(SPOT_META);
      for (const coin of ['@142', 'PURR/USDC', 'BTC', 'xyz:MU']) {
        service.resolveCoinName(coin).subscribe((name) => (resolved[coin] = name));
      }

      expect(resolved).toEqual({
        '@1': 'HFUN/USDC',
        '@142': 'BTC/USDC',
        'PURR/USDC': 'PURR/USDC',
        BTC: 'BTC',
        'xyz:MU': 'xyz:MU',
      });
    });

    it('resolves a display name to its protocol name, and leaves anything else alone', () => {
      const resolved: Record<string, string> = {};
      service
        .resolveToProtocolName('HFUN/USDC')
        .subscribe((name) => (resolved['HFUN/USDC'] = name));
      http.expectOne('http://hl.test/info').flush(SPOT_META);
      for (const coin of ['BTC/USDC', '@1', 'BTC', 'xyz:MU']) {
        service.resolveToProtocolName(coin).subscribe((name) => (resolved[coin] = name));
      }

      expect(resolved).toEqual({
        'HFUN/USDC': '@1',
        'BTC/USDC': '@142',
        '@1': '@1',
        BTC: 'BTC',
        'xyz:MU': 'xyz:MU',
      });
    });

    it('does not ask the network at all for a name that is not a spot pair', () => {
      service.resolveCoinName('BTC').subscribe();
      service.resolveToProtocolName('xyz:MU').subscribe();

      http.expectNone('http://hl.test/info');
    });
  });
});
