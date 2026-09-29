import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import { ConfigService } from '@services/config.service';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { UserService } from '@services/user.service';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { authInterceptor } from './auth.interceptor';

/**
 * ============================================================================
 * 🛑 QUI A LE DROIT DE RÉCLAMER LE JETON DU WALLET
 *
 * Depuis le 2026-09-29, l'intercepteur ne devine plus le destinataire : une
 * requête pose `withWalletToken()` ou n'obtient rien. Ce test garde les deux
 * moitiés de ce contrat.
 *
 * **La liste.** Deux services seulement vérifient ce jeton — celui qui l'émet,
 * et le gateway (`UserAuthGuard`, même `JWT_USER_SECRET`). Le risque de la
 * conception par opt-in est qu'on recopie l'appel ailleurs ; c'est le seul
 * risque qu'elle introduit, et il se voit dans un diff. Ici il fait rougir.
 *
 * **L'oubli inverse.** Un service de la liste qui cesserait de réclamer le
 * jeton prendrait un `401` — bruyant, mais en production. Les deux tests
 * d'intégration ci-dessous le prennent avant.
 * ============================================================================
 */

const SOURCE_ROOT = 'src/app';

/** Le fichier qui définit le contrat, et ceux qui ont le droit de l'invoquer. */
const ALLOWED_CALLERS: readonly string[] = [
  'src/app/core/interceptors/auth.interceptor.ts',
  'src/app/core/services/user.service.ts',
  'src/app/core/services/hyperliquid-gateway.service.ts',
];

const OPT_IN_SYMBOLS = ['withWalletToken', 'WITH_WALLET_TOKEN'] as const;

function listTsFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      files.push(full);
    }
  }

  return files;
}

describe('wallet token callers', () => {
  describe('the list of files allowed to ask', () => {
    it('is exactly the interceptor and the two services that validate the token', () => {
      const offenders = listTsFiles(SOURCE_ROOT)
        .filter((file) => {
          const content = readFileSync(file, 'utf8');
          return OPT_IN_SYMBOLS.some((symbol) => content.includes(symbol));
        })
        .map((file) => relative('.', file).split('\\').join('/'))
        .filter((file) => !ALLOWED_CALLERS.includes(file))
        .sort();

      expect(offenders).toEqual([]);
    });

    it('names no file that stopped asking', () => {
      // L'autre sens : une entrée de la liste qui n'utilise plus le symbole est
      // une liste qui ment, et un service qui a perdu son authentification.
      const silent = ALLOWED_CALLERS.filter((file) => {
        const content = readFileSync(file, 'utf8');
        return !OPT_IN_SYMBOLS.some((symbol) => content.includes(symbol));
      });

      expect(silent).toEqual([]);
    });
  });

  describe('the services actually send it', () => {
    const TOKEN = 'jwt.from.wallet';
    const USER_SERVICE = 'https://user.mondomaine.fr';
    const GATEWAY = 'https://gateway.mondomaine.fr';

    function setup() {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([authInterceptor])),
          provideHttpClientTesting(),
          { provide: AuthService, useValue: { currentToken: () => TOKEN } },
          {
            provide: ConfigService,
            useValue: { userServiceUrl: USER_SERVICE, hyperliquidGatewayUrl: GATEWAY },
          },
        ],
      });
      return TestBed.inject(HttpTestingController);
    }

    function headerOf(httpMock: HttpTestingController, url: string): string | null {
      const pending = httpMock.expectOne(url);
      const header = pending.request.headers.get('Authorization');
      pending.flush({});
      return header;
    }

    it('UserService authenticates its call to the user service', () => {
      const httpMock = setup();

      TestBed.inject(UserService).getMe().subscribe();

      expect(headerOf(httpMock, `${USER_SERVICE}/auth/me`)).toBe(`Bearer ${TOKEN}`);
      httpMock.verify();
    });

    it('HyperliquidGatewayService authenticates its call to the gateway', () => {
      const httpMock = setup();

      TestBed.inject(HyperliquidGatewayService).getOrderStatus(42).subscribe();

      expect(headerOf(httpMock, `${GATEWAY}/hyperliquid/orders/open/42`)).toBe(`Bearer ${TOKEN}`);
      httpMock.verify();
    });
  });
});
