import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ExternalUser, IExchange } from '@syldel/trading-shared-types';
import { WITH_WALLET_TOKEN } from '../interceptors/auth.interceptor';
import { ConfigService } from './config.service';
import { UserService } from './user.service';

/**
 * `updateStrategy` écrit la configuration de trading du compte. Ce qui compte :
 * que ça parte au bon endroit, authentifié, avec exactement ce qui a été
 * choisi — et qu'un refus du serveur arrive jusqu'à l'écran, puisque c'est lui
 * qui fait autorité, jamais la validation locale.
 */
describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;
  let config: { userServiceUrl: string };

  beforeEach(() => {
    config = { userServiceUrl: 'http://user.test' };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: config },
      ],
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getMe', () => {
    it('reads the account with the wallet token', () => {
      service.getMe().subscribe();

      const call = httpMock.expectOne('http://user.test/auth/me');
      expect(call.request.method).toBe('GET');
      expect(call.request.context.get(WITH_WALLET_TOKEN)).toBe(true);
      call.flush({});
    });
  });

  describe('updateStrategy', () => {
    const settings = { hyperliquid: { pairs: [] } } as unknown as Record<string, IExchange>;

    it('patches, never replaces, the trading settings of the account', () => {
      service.updateStrategy(settings).subscribe();

      const call = httpMock.expectOne('http://user.test/auth/strategy');
      expect(call.request.method).toBe('PATCH');
      call.flush({});
    });

    it('sends the settings unchanged', () => {
      service.updateStrategy(settings).subscribe();

      const call = httpMock.expectOne('http://user.test/auth/strategy');
      expect(call.request.body).toBe(settings);
      call.flush({});
    });

    // Écrire la config d'un compte sans jeton serait refusé — ou pire, accepté
    // par un serveur mal configuré. Le jeton n'est pas optionnel ici.
    it('asks for the wallet token', () => {
      service.updateStrategy(settings).subscribe();

      const call = httpMock.expectOne('http://user.test/auth/strategy');
      expect(call.request.context.get(WITH_WALLET_TOKEN)).toBe(true);
      call.flush({});
    });

    it('reads the user service URL at call time', () => {
      config.userServiceUrl = 'http://other-user.test';

      service.updateStrategy(settings).subscribe();

      httpMock.expectOne('http://other-user.test/auth/strategy').flush({});
    });

    it('returns the account as the server stored it, not what was sent', () => {
      const stored = {
        id: 'u1',
        tradingSettings: { hyperliquid: { pairs: ['BTC'] } },
      } as unknown as ExternalUser;
      let received: ExternalUser | undefined;

      service.updateStrategy(settings).subscribe((u) => (received = u));
      httpMock.expectOne('http://user.test/auth/strategy').flush(stored);

      expect(received).toEqual(stored);
    });

    it('lets a server refusal reach the caller untouched', () => {
      let error: { status: number; error: unknown } | undefined;

      service.updateStrategy(settings).subscribe({ error: (e) => (error = e) });
      httpMock
        .expectOne('http://user.test/auth/strategy')
        .flush({ message: 'Invalid stop-loss' }, { status: 400, statusText: 'Bad Request' });

      expect(error?.status).toBe(400);
      expect(error?.error).toEqual({ message: 'Invalid stop-loss' });
    });
  });
});
