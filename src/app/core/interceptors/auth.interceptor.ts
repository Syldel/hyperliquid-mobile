import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';

import { AuthService } from '@auth/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
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
  private readonly PUBLIC_ROUTES: readonly string[] = ['/login'];

  readonly auth = inject(AuthService);

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.auth.currentToken();

    const path = req.url.split('?')[0];
    const isPublicRoute = this.PUBLIC_ROUTES.some((route) => path.endsWith(route));

    let clonedReq = req;
    if (token && !isPublicRoute) {
      clonedReq = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    return next.handle(clonedReq).pipe(
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
          // this.auth.logout();
          // this.auth.removeTokenIfExpired(this.auth.currentAddress() || '');
        } else if (error.status === 403) {
          // ⚠️ Ce message annonce une redirection qui n'existe pas. Conservé tel
          // quel sur décision de l'utilisateur ; l'intercepteur ne fait que
          // relayer l'erreur.
          console.warn('Forbidden (403) - Redirecting to access denied page...');
        }
        return throwError(() => error);
      }),
    );
  }
}
