import { Routes } from '@angular/router';
// import { authGuard } from '../shared/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: 'secure',
    loadChildren: () => import('./features/secure/secure.routes').then((m) => m.SECURE_ROUTES),
    // canActivate: [authGuard],
  },
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' },
];
