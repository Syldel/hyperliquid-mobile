import { TestBed } from '@angular/core/testing';
import type { CollateralBalance } from '@syldel/hl-shared-types';
import { Subject, throwError } from 'rxjs';
import { AvailableCapitalService } from './available-capital.service';
import { HyperliquidGatewayService } from './hyperliquid-gateway.service';

/**
 * ============================================================================
 * Le capital qu'un écran chiffre, et ce qu'il avoue ne pas savoir.
 *
 * Trois règles portent ce service :
 *
 * - **ne jamais bombarder** — un TTL, et une seule requête en vol par marché ;
 * - **ne jamais figer une panne** — un échec de transport ne se met pas en
 *   cache : il durerait dix secondes de plus que la panne ;
 * - **ne jamais faire passer l'ignorance pour un zéro** — l'échec se dit
 *   `unavailable`, jamais `amount: 0`.
 *
 * La traduction de la réponse en message d'écran est testée dans
 * `available-capital.utils.spec.ts` ; ici, seulement ce que le service y ajoute.
 * ============================================================================
 */
describe('AvailableCapitalService', () => {
  let service: AvailableCapitalService;
  let getCollateralBalance: ReturnType<typeof vi.fn>;

  const ok = (total: string, used = '0'): CollateralBalance => ({
    status: 'ok',
    mode: 'unifiedAccount',
    collateral: 'USDC',
    collateralToken: 0,
    total,
    used,
  });

  /** Lecture synchrone du premier élément émis. */
  function firstValue<T>(source: { subscribe: (cb: (v: T) => void) => unknown }): T | undefined {
    let value: T | undefined;
    source.subscribe((v) => (value = v));
    return value;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));

    getCollateralBalance = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        AvailableCapitalService,
        { provide: HyperliquidGatewayService, useValue: { getCollateralBalance } },
      ],
    });
    service = TestBed.inject(AvailableCapitalService);
  });

  afterEach(() => vi.useRealTimers());

  it('asks the gateway for the market it was given, and reads what comes back', () => {
    getCollateralBalance.mockReturnValue(new Subject<CollateralBalance>());
    service.getAvailableCapital('xyz:BRENTOIL').subscribe();

    expect(getCollateralBalance).toHaveBeenCalledWith('xyz:BRENTOIL');
  });

  it('reports the available amount: the total less what is already committed', () => {
    const response = new Subject<CollateralBalance>();
    getCollateralBalance.mockReturnValue(response);

    let result: unknown;
    service.getAvailableCapital('BTC').subscribe((v) => (result = v));
    response.next(ok('100', '30'));

    expect(result).toEqual({ status: 'ok', asset: 'USDC', amount: 70 });
  });

  describe('the cache', () => {
    it('answers a second call from memory instead of asking the gateway again', () => {
      const response = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValue(response);
      service.getAvailableCapital('BTC').subscribe();
      response.next(ok('100'));

      const second = firstValue(service.getAvailableCapital('BTC'));

      expect(getCollateralBalance).toHaveBeenCalledTimes(1);
      expect(second).toEqual({ status: 'ok', asset: 'USDC', amount: 100 });
    });

    it('asks again once ten seconds have passed since the answer', () => {
      const first = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValueOnce(first);
      service.getAvailableCapital('BTC').subscribe();
      first.next(ok('100'));
      first.complete();

      vi.advanceTimersByTime(9_999);
      service.getAvailableCapital('BTC').subscribe();
      expect(getCollateralBalance).toHaveBeenCalledTimes(1);

      getCollateralBalance.mockReturnValueOnce(new Subject<CollateralBalance>());
      vi.advanceTimersByTime(2);
      service.getAvailableCapital('BTC').subscribe();
      expect(getCollateralBalance).toHaveBeenCalledTimes(2);
    });

    // Une réponse lente ne doit pas naître périmée : le TTL part de la réponse.
    it('starts the ten seconds when the answer arrives, not when it was asked for', () => {
      const slow = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValueOnce(slow);
      service.getAvailableCapital('BTC').subscribe();

      vi.advanceTimersByTime(8_000);
      slow.next(ok('100'));
      vi.advanceTimersByTime(5_000);

      service.getAvailableCapital('BTC').subscribe();
      expect(getCollateralBalance).toHaveBeenCalledTimes(1);
    });

    it('keeps one entry per market', () => {
      const btc = new Subject<CollateralBalance>();
      const eth = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValueOnce(btc).mockReturnValueOnce(eth);

      let btcResult: unknown;
      let ethResult: unknown;
      service.getAvailableCapital('BTC').subscribe((v) => (btcResult = v));
      service.getAvailableCapital('ETH').subscribe((v) => (ethResult = v));
      btc.next(ok('10'));
      eth.next(ok('20'));

      expect(btcResult).toMatchObject({ amount: 10 });
      expect(ethResult).toMatchObject({ amount: 20 });
      expect(getCollateralBalance).toHaveBeenCalledTimes(2);
    });

    // Un « je ne sais pas dans quoi ça se règle » est une réponse du gateway,
    // pas une panne : elle se met en cache comme un solde.
    it('caches a refusal the gateway gave, since that is an answer and not an outage', () => {
      const response = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValue(response);
      service.getAvailableCapital('BTC').subscribe();
      response.next({ status: 'unknown-collateral' } as CollateralBalance);

      service.getAvailableCapital('BTC').subscribe();

      expect(getCollateralBalance).toHaveBeenCalledTimes(1);
    });
  });

  describe('a request already in flight', () => {
    it('is shared by a second caller instead of sending a second request', () => {
      const response = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValue(response);

      let a: unknown;
      let b: unknown;
      service.getAvailableCapital('BTC').subscribe((v) => (a = v));
      service.getAvailableCapital('BTC').subscribe((v) => (b = v));
      response.next(ok('50'));

      expect(getCollateralBalance).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
      expect(a).toMatchObject({ status: 'ok', amount: 50 });
    });

    it('does not make a second market wait for the first', () => {
      getCollateralBalance.mockReturnValue(new Subject<CollateralBalance>());

      service.getAvailableCapital('BTC').subscribe();
      service.getAvailableCapital('ETH').subscribe();

      expect(getCollateralBalance).toHaveBeenCalledTimes(2);
    });
  });

  describe('when the gateway cannot be reached', () => {
    it('says "unavailable", never a zero', () => {
      getCollateralBalance.mockReturnValue(throwError(() => new Error('connection refused')));

      const result = firstValue(service.getAvailableCapital('BTC'));

      expect(result).toEqual({ status: 'unavailable' });
    });

    it('does not freeze the outage: the next call asks again straight away', () => {
      getCollateralBalance.mockReturnValueOnce(throwError(() => new Error('401')));
      service.getAvailableCapital('BTC').subscribe();

      const recovered = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValueOnce(recovered);
      let result: unknown;
      service.getAvailableCapital('BTC').subscribe((v) => (result = v));
      recovered.next(ok('42'));

      expect(getCollateralBalance).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ status: 'ok', amount: 42 });
    });
  });

  describe('invalidate', () => {
    it('makes the next call ask the gateway even inside the ten seconds', () => {
      const first = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValueOnce(first);
      service.getAvailableCapital('BTC').subscribe();
      first.next(ok('100'));

      service.invalidate();
      getCollateralBalance.mockReturnValueOnce(new Subject<CollateralBalance>());
      service.getAvailableCapital('BTC').subscribe();

      expect(getCollateralBalance).toHaveBeenCalledTimes(2);
    });

    it('drops a request in flight, so a balance read before a trade is not served after it', () => {
      const before = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValueOnce(before);
      service.getAvailableCapital('BTC').subscribe();

      service.invalidate();
      const after = new Subject<CollateralBalance>();
      getCollateralBalance.mockReturnValueOnce(after);
      let result: unknown;
      service.getAvailableCapital('BTC').subscribe((v) => (result = v));
      after.next(ok('900'));

      expect(getCollateralBalance).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ amount: 900 });
    });
  });
});
