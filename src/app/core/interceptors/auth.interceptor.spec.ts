import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { ConfigService } from '@services/config.service';
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
 *
 * L'autre point qui se garde ici : **à qui le jeton a le droit d'être montré**.
 * Deux services le valident — le service utilisateur qui l'émet, et le gateway
 * (`UserAuthGuard`, même `JWT_USER_SECRET`). Le bot n'en veut pas, et
 * `api.hyperliquid.xyz` est un tiers.
 * ============================================================================
 */

const TOKEN = 'jwt.from.wallet';

const USER_SERVICE = 'http://user.test';
const GATEWAY = 'http://gateway.test';
const BOT_SERVICE = 'http://bot.test';
const PUBLIC_HL = 'https://api.hyperliquid.xyz';

const USER_SERVICE_URL = `${USER_SERVICE}/auth/me`;
const LOGIN_URL = `${USER_SERVICE}/auth/login`;
const GATEWAY_URL = `${GATEWAY}/hyperliquid/orders`;
const BOT_URL = `${BOT_SERVICE}/exchanges/meta`;
const PUBLIC_HL_URL = `${PUBLIC_HL}/info`;

const FULL_CONFIG = {
  userServiceUrl: USER_SERVICE,
  hyperliquidGatewayUrl: GATEWAY,
  botServiceUrl: BOT_SERVICE,
  hyperliquidPublicUrl: PUBLIC_HL,
};

function createAuthMock(token: string | null) {
  return {
    currentToken: () => token,
    currentAddress: () => '0xABC123',
    logout: vi.fn(),
    removeTokenIfExpired: vi.fn(),
  };
}

function setup(token: string | null, config: Partial<typeof FULL_CONFIG> = FULL_CONFIG) {
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
      { provide: ConfigService, useValue: config },
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

    it('attaches the token to the gateway, which validates the same JWT', () => {
      // Le gateway porte `UserAuthGuard` sur ses contrôleurs d'ordres, de trade,
      // d'info et de fills, et vérifie le jeton avec le même `JWT_USER_SECRET`
      // que le service utilisateur. Le priver de l'en-tête casserait le trading.
      const { http, httpMock } = setup(TOKEN);

      http.post(GATEWAY_URL, {}).subscribe();

      expect(sentAuthHeader(httpMock, GATEWAY_URL)).toBe(`Bearer ${TOKEN}`);
    });

    it('never shows the token to the bot or to the public Hyperliquid API', () => {
      // Le bot ne pose aucun garde sur les routes consommées ici, et
      // `api.hyperliquid.xyz` est un tiers : lui transmettre le JWT du service
      // utilisateur l'expose à ses journaux pour rien.
      const { http, httpMock } = setup(TOKEN);

      http.post(PUBLIC_HL_URL, {}).subscribe();
      http.get(BOT_URL).subscribe();

      // Les deux requêtes sont vidées avant toute assertion : un échec sur la
      // première ne doit pas laisser la seconde en attente.
      const towardsPublicApi = sentAuthHeader(httpMock, PUBLIC_HL_URL);
      const towardsBot = sentAuthHeader(httpMock, BOT_URL);

      expect(towardsPublicApi).toBeNull();
      expect(towardsBot).toBeNull();
    });

    it('shows the token to nobody while no service url is configured', () => {
      // Le build de production part avec des URL vides tant que l'utilisateur
      // n'a rien saisi. Une comparaison par préfixe sur une chaîne vide est
      // vraie pour **toute** URL : ce test garde ce piège.
      const { http, httpMock } = setup(TOKEN, {
        userServiceUrl: '',
        hyperliquidGatewayUrl: '',
        botServiceUrl: '',
        hyperliquidPublicUrl: '',
      });

      http.get(PUBLIC_HL_URL).subscribe();

      expect(sentAuthHeader(httpMock, PUBLIC_HL_URL)).toBeNull();
    });

    it('shows the token to nobody on a relative url when nothing is configured', () => {
      // Sans le garde sur la base vide, `startsWith('/')` serait vrai pour toute
      // URL relative — un `/assets/…` récupéré par `HttpClient` partirait avec
      // le jeton. La frontière sur le `/` ne suffit pas à couvrir ce cas : il
      // faut refuser une base vide explicitement.
      const { http, httpMock } = setup(TOKEN, {
        userServiceUrl: '',
        hyperliquidGatewayUrl: '',
        botServiceUrl: '',
        hyperliquidPublicUrl: '',
      });
      const url = '/assets/catalog.json';

      http.get(url).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBeNull();
    });

    it('does not mistake a host whose url merely starts the same', () => {
      // `http://user.test` ne doit pas autoriser `http://user.testing.evil`,
      // ni `http://localhost:3010` autoriser `http://localhost:30100`.
      const { http, httpMock } = setup(TOKEN);
      const url = 'http://user.testing.example/auth/me';

      http.get(url).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBeNull();
    });
  });

  describe('on production-shaped urls', () => {
    // En production les services ne sont pas des `localhost:99xx` : ce sont des
    // sous-domaines, parfois un seul hôte avec des préfixes de chemin, souvent
    // une barre finale saisie dans le formulaire de configuration. Les
    // topologies ci-dessous ont été confrontées à l'implémentation avant d'être
    // figées ici.

    it('separates services hosted on distinct subdomains', () => {
      const cfg = {
        userServiceUrl: 'https://user.mondomaine.fr',
        hyperliquidGatewayUrl: 'https://gateway.mondomaine.fr',
        botServiceUrl: 'https://bot.mondomaine.fr',
        hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
      };
      const { http, httpMock } = setup(TOKEN, cfg);
      const user = `${cfg.userServiceUrl}/auth/me`;
      const bot = `${cfg.botServiceUrl}/exchanges/meta`;

      http.get(user).subscribe();
      http.get(bot).subscribe();
      const towardsUser = sentAuthHeader(httpMock, user);
      const towardsBot = sentAuthHeader(httpMock, bot);

      expect(towardsUser).toBe(`Bearer ${TOKEN}`);
      expect(towardsBot).toBeNull();
    });

    it('separates services sharing one host behind path prefixes', () => {
      const cfg = {
        userServiceUrl: 'https://api.mondomaine.fr/user',
        hyperliquidGatewayUrl: 'https://api.mondomaine.fr/gateway',
        botServiceUrl: 'https://api.mondomaine.fr/bot',
        hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
      };
      const { http, httpMock } = setup(TOKEN, cfg);
      const gateway = `${cfg.hyperliquidGatewayUrl}/hyperliquid/orders`;
      const bot = `${cfg.botServiceUrl}/exchanges/meta`;

      http.post(gateway, {}).subscribe();
      http.get(bot).subscribe();
      const towardsGateway = sentAuthHeader(httpMock, gateway);
      const towardsBot = sentAuthHeader(httpMock, bot);

      expect(towardsGateway).toBe(`Bearer ${TOKEN}`);
      expect(towardsBot).toBeNull();
    });

    it('does not let a service at a host root swallow another under its path', () => {
      // Le cas qui a fait changer l'implémentation : une simple comparaison de
      // préfixe donne le jeton au bot, puisque son URL commence bien par celle
      // du service utilisateur. C'est le service dont la base correspond **le
      // plus longuement** qui reçoit la requête.
      const cfg = {
        userServiceUrl: 'https://api.mondomaine.fr',
        hyperliquidGatewayUrl: 'https://gateway.mondomaine.fr',
        botServiceUrl: 'https://api.mondomaine.fr/bot',
        hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
      };
      const { http, httpMock } = setup(TOKEN, cfg);
      const user = `${cfg.userServiceUrl}/auth/me`;
      const bot = `${cfg.botServiceUrl}/exchanges/meta`;

      http.get(user).subscribe();
      http.get(bot).subscribe();
      const towardsUser = sentAuthHeader(httpMock, user);
      const towardsBot = sentAuthHeader(httpMock, bot);

      expect(towardsUser).toBe(`Bearer ${TOKEN}`);
      expect(towardsBot).toBeNull();
    });

    it('shows nothing when two services claim exactly the same base', () => {
      // Configuration incohérente, mais saisissable. On ne devine pas : à
      // égalité, le jeton ne part pas.
      const cfg = {
        userServiceUrl: 'https://api.mondomaine.fr',
        hyperliquidGatewayUrl: 'https://gateway.mondomaine.fr',
        botServiceUrl: 'https://api.mondomaine.fr',
        hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
      };
      const { http, httpMock } = setup(TOKEN, cfg);
      const url = 'https://api.mondomaine.fr/auth/me';

      http.get(url).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBeNull();
    });

    it('tolerates trailing slashes in the configured urls', () => {
      const cfg = {
        userServiceUrl: 'https://user.mondomaine.fr/',
        hyperliquidGatewayUrl: 'https://gateway.mondomaine.fr//',
        botServiceUrl: 'https://bot.mondomaine.fr/',
        hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
      };
      const { http, httpMock } = setup(TOKEN, cfg);
      const gateway = 'https://gateway.mondomaine.fr/hyperliquid/orders';

      http.post(gateway, {}).subscribe();

      expect(sentAuthHeader(httpMock, gateway)).toBe(`Bearer ${TOKEN}`);
    });

    it('shows nothing on a relative url when only one service is configured', () => {
      // Le cas qui rend le refus d'une base vide décisif : les trois autres
      // bases sont vides, elles ne participent donc pas à l'arbitrage, et
      // `startsWith('/')` ferait du service utilisateur le destinataire de
      // n'importe quel `/assets/…`.
      const { http, httpMock } = setup(TOKEN, {
        userServiceUrl: '',
        hyperliquidGatewayUrl: 'https://gateway.mondomaine.fr',
        botServiceUrl: 'https://bot.mondomaine.fr',
        hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
      });
      const url = '/assets/catalog.json';

      http.get(url).subscribe();

      expect(sentAuthHeader(httpMock, url)).toBeNull();
    });

    it('shows nothing to the public API proxied under a trusted host', () => {
      // Topologie plausible : l'API publique Hyperliquid relayée par son propre
      // domaine pour éviter le CORS. Son chemin tombe alors sous celui du
      // service utilisateur — c'est sa présence dans l'arbitrage, et elle seule,
      // qui l'empêche d'hériter de la confiance de son hôte.
      const cfg = {
        userServiceUrl: 'https://api.mondomaine.fr',
        hyperliquidGatewayUrl: 'https://gateway.mondomaine.fr',
        botServiceUrl: 'https://bot.mondomaine.fr',
        hyperliquidPublicUrl: 'https://api.mondomaine.fr/hl-proxy',
      };
      const { http, httpMock } = setup(TOKEN, cfg);
      const proxied = `${cfg.hyperliquidPublicUrl}/info`;

      http.post(proxied, {}).subscribe();

      expect(sentAuthHeader(httpMock, proxied)).toBeNull();
    });

    it('is not fooled by a domain that merely prefixes the configured one', () => {
      const cfg = {
        userServiceUrl: 'https://user.mondomaine.fr',
        hyperliquidGatewayUrl: 'https://gateway.mondomaine.fr',
        botServiceUrl: 'https://bot.mondomaine.fr',
        hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
      };
      const { http, httpMock } = setup(TOKEN, cfg);
      const lookalike = 'https://user.mondomaine.fr.attaquant.net/auth/me';

      http.get(lookalike).subscribe();

      expect(sentAuthHeader(httpMock, lookalike)).toBeNull();
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
