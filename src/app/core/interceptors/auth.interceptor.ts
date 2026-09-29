import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '@auth/auth.service';

/**
 * Les routes que l'on interroge sans jeton, comparées à la **fin du chemin**,
 * query retirée.
 *
 * Ni motif ni joker. La version précédente compilait une `RegExp` par entrée
 * et par requête, en y remplaçant les astérisques par « n'importe quoi » :
 * elle traitait une chaîne comme un motif sans que personne l'ait demandé.
 * Deux conséquences, mesurées le 2026-09-29 :
 *
 * - l'expression s'appliquait à l'**URL entière**, query comprise. Une route
 *   privée du genre `/auth/me?redirect=/login` passait donc pour publique et
 *   partait sans jeton. Aucun appel de l'app ne construit de query
 *   aujourd'hui, le piège attendait le premier `?returnUrl=` ;
 * - un métacaractère dans une future entrée changeait silencieusement le
 *   sens : `/v1.0/login` aurait aussi accepté `/v1X0/login`.
 *
 * Si un vrai motif devient nécessaire, il faudra échapper les parties
 * littérales, pas seulement remplacer `*`.
 */
const PUBLIC_ROUTES: readonly string[] = ['/login'];

/**
 * Joint le jeton du wallet courant aux requêtes sortantes.
 *
 * ⚠️ Le seul filtre est la liste ci-dessus : le jeton part donc aussi vers le
 * bot, le gateway et `api.hyperliquid.xyz`, un tiers qui n'en a aucun usage.
 * Décrit et mesuré dans `auth.interceptor.spec.ts` (cas marqué ⚠️) et dans
 * docs/ecosystem.md. Restreindre l'en-tête à `userServiceUrl` ferait tomber ce
 * test, ce qui est exactement son rôle.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.currentToken();

  const path = req.url.split('?')[0];
  const isPublicRoute = PUBLIC_ROUTES.some((route) => path.endsWith(route));

  const outgoing =
    token && !isPublicRoute ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(outgoing).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isPublicRoute) {
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
