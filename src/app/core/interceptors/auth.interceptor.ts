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
  private readonly PUBLIC_ROUTES: string[] = ['/login'];

  readonly auth = inject(AuthService);

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.auth.currentToken();

    const isPublicRoute = this.PUBLIC_ROUTES.some((route) => {
      const routePattern = route.replace(/\*/g, '.*');
      const regex = new RegExp(`${routePattern}(\\?.*)?$`);
      return regex.test(req.url);
    });

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
