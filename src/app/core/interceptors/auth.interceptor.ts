import {
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '@auth/auth.service';

/**
 * Drapeau qu'une requête pose pour **réclamer** le jeton du wallet.
 *
 * Par défaut : `false`. Une requête n'emporte donc le `Authorization` que si
 * son auteur l'a écrit noir sur blanc.
 *
 * C'est l'inverse de ce que faisait cet intercepteur jusqu'au 2026-09-29, et
 * l'inversion est tout l'intérêt. Il **devinait** le destinataire depuis la
 * forme de l'URL, en la comparant aux bases configurées ; chaque topologie de
 * production devenait alors une devinette de plus. Trois cas plausibles lui
 * échappaient encore — un service à la racine d'un hôte et un autre sous un
 * chemin du même hôte, deux services sur la même base, l'API publique relayée
 * pour contourner le CORS — et rien n'aurait signalé le prochain.
 *
 * Surtout, le mode de défaillance était le mauvais : un appel ajouté demain
 * vers un hôte mal deviné aurait emporté le jeton **en silence**. Désormais un
 * appel qui oublie de le réclamer reçoit un `401` — bruyant, immédiat,
 * diagnostiqué en une minute.
 *
 * Qui a le droit de le poser : `user.service.ts` (le service utilisateur émet
 * et vérifie le jeton) et `hyperliquid-gateway.service.ts` (`UserAuthGuard`,
 * même `JWT_USER_SECRET`). `wallet-token-callers.spec.ts` garde cette liste.
 */
export const WITH_WALLET_TOKEN = new HttpContextToken<boolean>(() => false);

/**
 * À passer en options d'un appel `HttpClient` qui doit être authentifié :
 *
 * ```ts
 * this.http.get<ExternalUser>(url, withWalletToken());
 * ```
 */
export function withWalletToken(): { context: HttpContext } {
  return { context: new HttpContext().set(WITH_WALLET_TOKEN, true) };
}

/**
 * Joint le jeton du wallet aux seules requêtes qui le réclament.
 *
 * Les routes de connexion ne le réclament pas — présenter l'ancien jeton pour
 * en demander un nouveau n'aurait pas de sens — ce qui rend inutile la liste de
 * routes publiques que cet intercepteur entretenait.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  const wantsWalletToken = req.context.get(WITH_WALLET_TOKEN);
  const token = wantsWalletToken ? auth.currentToken() : null;

  const outgoing = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(outgoing).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && wantsWalletToken) {
        // La déconnexion automatique est **délibérément** désactivée : on se
        // connecte une fois pour mémoriser l'adresse du wallet, et `/secure`
        // reste consultable ensuite sans jeton valide, l'essentiel de ce qui
        // s'y lit venant de l'API publique Hyperliquid. Déconnecter sur un 401
        // éjecterait l'utilisateur d'écrans qui n'avaient pas besoin de lui.
        //
        // Les deux appels ci-dessous existent et fonctionnent — c'est leur
        // usage ici qui est écarté, pas leur disponibilité. Ne pas les
        // réactiver sans changer l'architecture de session :
        // docs/ecosystem.md#le-modèle-de-session--une-adresse-mémorisée-un-jeton-optionnel
        // `auth.interceptor.spec.ts` fige ce choix par un test.
        console.warn('Unauthorized (401) - Logout...');
        // auth.logout();
        // auth.removeTokenIfExpired(auth.currentAddress() || '');
      } else if (error.status === 403) {
        // ⚠️ Ce message annonce une redirection qui n'existe pas. Conservé tel
        // quel sur décision de l'utilisateur ; l'intercepteur ne fait que
        // relayer l'erreur.
        console.warn('Forbidden (403) - Redirecting to access denied page...');
      }
      return throwError(() => error);
    }),
  );
};
