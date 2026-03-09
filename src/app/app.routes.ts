import { Routes } from '@angular/router';
import { WalletGuard } from '@auth/wallet.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: 'secure',
    loadChildren: () => import('./features/secure/secure.routes').then((m) => m.SECURE_ROUTES),
    canActivate: [WalletGuard],
  },
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' },
];
