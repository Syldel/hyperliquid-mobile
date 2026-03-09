import { inject, Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class WalletGuard implements CanActivate {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  async canActivate(): Promise<boolean | UrlTree> {
    await firstValueFrom(this.authService.ready$.pipe(filter((r) => r === true)));

    if (this.authService.currentAddress()) return true;
    return this.router.createUrlTree(['/auth/login']);
  }
}
