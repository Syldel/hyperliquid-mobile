import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CandleSnapshot, CandleSnapshotRequest } from '@syldel/hl-shared-types';
import { ConfigService } from './config.service';
import { HyperliquidCandleService } from './hyperliquid-candle.service';

/**
 * Le cache des bougies du chart sans surcouche, et ce qu'un rafraîchissement forcé en fait.
 *
 * Forcer saute la lecture du cache mais pas son écriture : sinon, le premier appel ordinaire après un
 * rafraîchissement resservait les bougies d'avant, et le chart reculait.
 */
describe('HyperliquidCandleService — cache', () => {
  let service: HyperliquidCandleService;
  let httpMock: HttpTestingController;

  // 1H : TTL 15 min. La fenêtre est fixe pour que la clé ne change pas entre deux appels.
  const req: CandleSnapshotRequest = {
    coin: 'BTC',
    interval: '1h',
    startTime: 1_800_000_000_000,
    endTime: 1_800_003_600_000,
  };
  const before = [{ t: 1, c: '100' }] as unknown as CandleSnapshot[];
  const after = [{ t: 1, c: '101' }] as unknown as CandleSnapshot[];
  const url = 'https://api.test/info';

  const read = (options?: { fresh?: boolean }) => {
    let received: CandleSnapshot[] | undefined;
    service.getCandles(req, options).subscribe((candles) => (received = candles));
    return () => received;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { hyperliquidPublicUrl: 'https://api.test' } },
      ],
    });
    service = TestBed.inject(HyperliquidCandleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('serves a second identical read from the cache', () => {
    read();
    httpMock.expectOne(url).flush(before);

    const second = read();

    httpMock.expectNone(url);
    expect(second()).toBe(before);
  });

  it('reads the network again when asked for fresh candles', () => {
    read();
    httpMock.expectOne(url).flush(before);

    const fresh = read({ fresh: true });
    httpMock.expectOne(url).flush(after);

    expect(fresh()).toBe(after);
  });

  it('keeps the fresh candles for the next ordinary read', () => {
    read();
    httpMock.expectOne(url).flush(before);
    read({ fresh: true });
    httpMock.expectOne(url).flush(after);

    const next = read();

    httpMock.expectNone(url);
    expect(next()).toBe(after);
  });

  // L'heure affichée à côté du prix, derrière une horloge : celle de la lecture, d'où que sortent les bougies.
  describe('when the candles were received', () => {
    const t0 = 1_800_000_000_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(t0);
    });

    afterEach(() => vi.useRealTimers());

    const readTimed = (options?: { fresh?: boolean }) => {
      let received: { candles: CandleSnapshot[]; readAt: number } | undefined;
      service.getCandlesWithTime(req, options).subscribe((timed) => (received = timed));
      return () => received;
    };

    // Re-dater au moment du service ferait passer le cache pour une lecture neuve.
    it('gives the time of the read for a cache hit, not the time of the hit', () => {
      readTimed();
      httpMock.expectOne(url).flush(before);

      vi.setSystemTime(t0 + 60_000);
      const hit = readTimed();

      expect(hit()).toEqual({ candles: before, readAt: t0 });
    });

    // La réception, pas l'envoi : un appel lent ne doit pas vieillir des bougies qui viennent d'arriver.
    it('dates a network read when the answer arrives', () => {
      const timed = readTimed({ fresh: true });
      vi.setSystemTime(t0 + 3_000);
      httpMock.expectOne(url).flush(after);

      expect(timed()).toEqual({ candles: after, readAt: t0 + 3_000 });
    });
  });
});
