import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { authInterceptor, withWalletToken } from './auth.interceptor';

/**
 * ============================================================================
 * CE QUE L'INTERCEPTEUR A LE DROIT DE FAIRE DU JETON
 *
 * Le contrat s'est inversé le 2026-09-29. L'intercepteur ne **devine** plus le
 * destinataire depuis la forme de l'URL : une requête **réclame** le jeton, ou
 * ne le reçoit pas. D'où le premier test, qui vaut pour tous les autres — une
 * URL, même parfaitement crédible, n'obtient rien par sa seule apparence.
 *
 * Ce que l'inversion fait disparaître : la sensibilité aux topologies de
 * production (sous-domaines, préfixes de chemin, hôte partagé, API relayée
 * pour contourner le CORS), dont trois cas plausibles échappaient encore à la
 * comparaison d'URL — et rien n'aurait signalé le prochain.
 *
 * Ce qu'elle déplace : la décision vit maintenant aux sites d'appel.
 * `wallet-token-callers.spec.ts` garde la liste de ceux qui y ont droit.
 *
 * Et le test le moins intuitif du lot reste là : **un 401 ne déconnecte pas**.
 * C'est un choix, décrit dans
 * `docs/ecosystem.md#le-modèle-de-session--une-adresse-mémorisée-un-jeton-optionnel`.
 * ============================================================================
 */

const TOKEN = 'jwt.from.wallet';

const USER_SERVICE_URL = 'https://user.mondomaine.fr/auth/me';
const GATEWAY_URL = 'https://gateway.mondomaine.fr/hyperliquid/orders';
const PUBLIC_HL_URL = 'https://api.hyperliquid.xyz/info';

function createAuthMock(token: string | null) {
  return {
    currentToken: () => token,
    currentAddress: () => '0xABC123',
    logout: vi.fn(),
    removeTokenIfExpired: vi.fn(),
  };
}

function setup(token: string | null) {
  const auth = createAuthMock(token);

  // Sans cette remise à zéro, un test qui échoue laisse le module instancié et
  // le suivant ne peut plus se configurer : une seule assertion fausse en fait
  // tomber cinq, et on cherche le défaut au mauvais endroit.
  TestBed.resetTestingModule();

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
    ],
  });

  return {
    auth,
    http: TestBed.inject(HttpClient),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

/** L'en-tête tel qu'il part réellement sur le réseau, ou `null`. */
function sentAuthHeader(httpMock: HttpTestingController, url: string): string | null {
  const pending = httpMock.expectOne(url);
  const header = pending.request.headers.get('Authorization');
  pending.flush({});
  return header;
}

describe('authInterceptor', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
  });

  describe('what it attaches, and when', () => {
    it('attaches nothing to a request that did not ask, however trusted its url', () => {
      // Le cœur du contrat : l'URL ne donne aucun droit. Celle-ci est pourtant
      // exactement celle du service utilisateur.
      const { http, httpMock } = setup(TOKEN);

      http.get(USER_SERVICE_URL).subscribe();

      expect(sentAuthHeader(httpMock, USER_SERVICE_URL)).toBeNull();
    });

    it('attaches the wallet token to a request that asks for it', () => {
      // `Bearer` fait partie du contrat, pas de la décoration : le gateway lit
      // `authHeader.split(' ')[1]`.
      const { http, httpMock } = setup(TOKEN);

      http.get(USER_SERVICE_URL, withWalletToken()).subscribe();

      expect(sentAuthHeader(httpMock, USER_SERVICE_URL)).toBe(`Bearer ${TOKEN}`);
    });

    it('attaches nothing when the request asks but no wallet holds a token', () => {
      // Le cas nominal de cette app : on navigue dans `secure` sans être
      // authentifié, l'adresse mémorisée ayant suffi au `WalletGuard`.
      const { http, httpMock } = setup(null);

      http.get(USER_SERVICE_URL, withWalletToken()).subscribe();

      expect(sentAuthHeader(httpMock, USER_SERVICE_URL)).toBeNull();
    });

    it('lets intent decide, not the host: a third party stays bare, the gateway is served', () => {
      const { http, httpMock } = setup(TOKEN);

      http.post(PUBLIC_HL_URL, {}).subscribe();
      http.post(GATEWAY_URL, {}, withWalletToken()).subscribe();

      // Les deux requêtes sont vidées avant toute assertion : un échec sur la
      // première ne doit pas laisser la seconde en attente.
      const towardsThirdParty = sentAuthHeader(httpMock, PUBLIC_HL_URL);
      const towardsGateway = sentAuthHeader(httpMock, GATEWAY_URL);

      expect(towardsThirdParty).toBeNull();
      expect(towardsGateway).toBe(`Bearer ${TOKEN}`);
    });
  });

  describe('what it does with errors', () => {
    it('relays a 401 to the caller **without logging out**', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { auth, http, httpMock } = setup(TOKEN);
      let status: number | null = null;

      http
        .get(USER_SERVICE_URL, withWalletToken())
        .subscribe({ error: (e) => (status = e.status) });
      httpMock.expectOne(USER_SERVICE_URL).flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(status).toBe(401);
      // Le cœur de la philosophie : un jeton expiré ne doit pas éjecter
      // l'utilisateur des écrans qui ne lisent que de l'API publique.
      expect(auth.logout).not.toHaveBeenCalled();
      expect(auth.removeTokenIfExpired).not.toHaveBeenCalled();
    });

    it('relays a 403 to the caller', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { auth, http, httpMock } = setup(TOKEN);
      let status: number | null = null;

      http
        .get(USER_SERVICE_URL, withWalletToken())
        .subscribe({ error: (e) => (status = e.status) });
      httpMock.expectOne(USER_SERVICE_URL).flush(null, { status: 403, statusText: 'Forbidden' });

      expect(status).toBe(403);
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('relays an error on a request that never asked for the token', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { http, httpMock } = setup(TOKEN);
      let status: number | null = null;

      http.get(PUBLIC_HL_URL).subscribe({ error: (e) => (status = e.status) });
      httpMock.expectOne(PUBLIC_HL_URL).flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(status).toBe(401);
    });

    it('lets a normal response through untouched', () => {
      const { http, httpMock } = setup(TOKEN);
      let body: unknown = null;

      http.get(USER_SERVICE_URL, withWalletToken()).subscribe((r) => (body = r));
      httpMock.expectOne(USER_SERVICE_URL).flush({ ok: true });

      expect(body).toEqual({ ok: true });
    });
  });
});
