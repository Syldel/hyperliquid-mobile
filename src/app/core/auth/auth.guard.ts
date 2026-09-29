import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';

import { filter, firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * ⚠️ Ce garde ne garde **rien** : aucun fichier ne l'importe (vérifié le
 * 2026-09-29), seul `WalletGuard` est posé sur `/secure` dans `app.routes.ts`.
 *
 * Ce n'est pas un oubli. L'app se connecte une fois pour mémoriser l'adresse du
 * wallet, puis laisse consulter `/secure` sans jeton valide, parce que
 * l'essentiel de ce qu'on y lit vient de l'API publique Hyperliquid. Exiger
 * `isLoggedIn()` ici remplacerait cette architecture par une autre — voir
 * [docs/ecosystem.md](../../../../docs/ecosystem.md#le-modèle-de-session--une-adresse-mémorisée-un-jeton-optionnel).
 *
 * Il est conservé parce qu'il redeviendra utile le jour où une route exigera
 * réellement une authentification. Le câbler sur `/secure` serait une
 * régression.
 */
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> {
    await firstValueFrom(this.authService.ready$.pipe(filter((r) => r === true)));

    const isLoggedIn = this.authService.isLoggedIn();
    const goingToLogin = route.routeConfig?.path === 'login';

    if (goingToLogin && isLoggedIn) {
      return this.router.parseUrl('/balances');
    }

    if (!goingToLogin && !isLoggedIn) {
      return this.router.parseUrl('/login');
    }

    return true;
  }
}
