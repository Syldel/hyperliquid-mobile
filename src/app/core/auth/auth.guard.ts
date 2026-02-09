import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';

import { filter, firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> {
    await firstValueFrom(this.auth.ready$.pipe(filter((r) => r === true)));

    const isLoggedIn = this.auth.isLoggedIn();
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
