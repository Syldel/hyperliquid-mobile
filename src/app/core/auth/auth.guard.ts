import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';

import { filter, firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

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
