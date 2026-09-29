import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { authInterceptor } from './auth.interceptor';

/**
 * ============================================================================
 * CE QUE L'INTERCEPTEUR A LE DROIT DE FAIRE DU JETON
 *
 * Ces tests **figent le comportement voulu**, ils ne proposent pas de le
 * changer. La philosophie de session est décrite dans
 * `docs/ecosystem.md#le-modèle-de-session--une-adresse-mémorisée-un-jeton-optionnel` :
 * on se connecte une fois pour mémoriser l'adresse, et la partie `secure`
 * reste consultable ensuite sans jeton valide, parce que l'essentiel de ce
 * qu'on y lit vient de l'API publique Hyperliquid.
 *
 * D'où le test le moins intuitif du lot : **un 401 ne déconnecte pas**. C'est
 * un choix, pas un oubli, et il est ici pour que personne ne le « corrige »
 * sans faire rougir la suite.
 * ============================================================================
 */

const TOKEN = 'jwt.from.wallet';

const USER_SERVICE_URL = 'http://user.test/auth/me';
const LOGIN_URL = 'http://user.test/auth/login';
const BOT_URL = 'http://bot.test/exchanges/meta';
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

  describe('what it attaches, and to whom', () => {
    it('attaches the current wallet token to a user-service call', () => {
      const { http, httpMock } = setup(TOKEN);

      http.get(USER_SERVICE_URL).subscribe();

      expect(sentAuthHeader(httpMock, USER_SERVICE_URL)).toBe(`Bearer ${TOKEN}`);
    });

    it('attaches nothing while no wallet holds a token', () => {
      // Le cas nominal de cette app : on navigue dans `secure` sans être
      // authentifié, l'adresse mémorisée ayant suffi au `WalletGuard`.
      const { http, httpMock } = setup(null);

      http.get(USER_SERVICE_URL).subscribe();

      expect(sentAuthHeader(httpMock, USER_SERVICE_URL)).toBeNull();
    });

    it('attaches nothing to the login route, even with a token in memory', () => {
      // Sinon on présenterait l'ancien jeton pour en demander un nouveau.
      const { http, httpMock } = setup(TOKEN);

      http.post(LOGIN_URL, {}).subscribe();

      expect(sentAuthHeader(httpMock, LOGIN_URL)).toBeNull();
    });

    it('attaches nothing to the login route when it carries a query string', () => {
      // La query ne doit pas empêcher de reconnaître la route.
      const { http, httpMock } = setup(TOKEN);
      const url = `${LOGIN_URL}?redirect=/balances`;

      http.post(url, {}).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBeNull();
    });

    it('attaches the token to a private route whose query merely ends in /login', () => {
      // La reconnaissance porte sur le **chemin**, pas sur l'URL entière : une
      // query qui se termine par `/login` ne rend pas la route publique.
      // Mesuré le 2026-09-29 : l'ancienne comparaison, une `RegExp` appliquée à
      // l'URL complète, prenait cette route pour publique et la privait de son
      // jeton. Aucun appel de l'app ne construit de query aujourd'hui, donc le
      // piège n'avait jamais servi — il attendait le premier `?returnUrl=`.
      const { http, httpMock } = setup(TOKEN);
      const url = `${USER_SERVICE_URL}?redirect=/login`;

      http.get(url).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBe(`Bearer ${TOKEN}`);
    });

    it('attaches the token to a path that continues past /login', () => {
      // La reconnaissance porte sur la **fin** du chemin : une sous-route de
      // `/login` n'hérite pas de son caractère public. Sans ce test, remplacer
      // `endsWith` par `includes` ne cassait rien.
      const { http, httpMock } = setup(TOKEN);
      const url = 'http://user.test/auth/login/verify';

      http.get(url).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBe(`Bearer ${TOKEN}`);
    });

    it('attaches the token to a path that merely ends with the word login', () => {
      const { http, httpMock } = setup(TOKEN);
      const url = 'http://user.test/auth/relogin';

      http.get(url).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBe(`Bearer ${TOKEN}`);
    });

    it('⚠️ also attaches the token to the bot and to the public Hyperliquid API', () => {
      // Ce test décrit l'état actuel, pas un état souhaitable : le seul
      // filtre est « l'URL ne finit pas par /login », donc le JWT part vers
      // `api.hyperliquid.xyz`, un tiers qui n'a rien à en faire. Le jour où
      // l'on restreint l'en-tête au service utilisateur, ce test doit tomber
      // — c'est précisément son rôle. Voir docs/ecosystem.md.
      const { http, httpMock } = setup(TOKEN);

      http.post(PUBLIC_HL_URL, {}).subscribe();
      http.get(BOT_URL).subscribe();

      expect(sentAuthHeader(httpMock, PUBLIC_HL_URL)).toBe(`Bearer ${TOKEN}`);
      expect(sentAuthHeader(httpMock, BOT_URL)).toBe(`Bearer ${TOKEN}`);
    });
  });

  describe('what it does with errors', () => {
    it('relays a 401 to the caller **without logging out**', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { auth, http, httpMock } = setup(TOKEN);
      let status: number | null = null;

      http.get(USER_SERVICE_URL).subscribe({ error: (e) => (status = e.status) });
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

      http.get(USER_SERVICE_URL).subscribe({ error: (e) => (status = e.status) });
      httpMock.expectOne(USER_SERVICE_URL).flush(null, { status: 403, statusText: 'Forbidden' });

      expect(status).toBe(403);
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('lets a normal response through untouched', () => {
      const { http, httpMock } = setup(TOKEN);
      let body: unknown = null;

      http.get(USER_SERVICE_URL).subscribe((r) => (body = r));
      httpMock.expectOne(USER_SERVICE_URL).flush({ ok: true });

      expect(body).toEqual({ ok: true });
    });
  });
});
