import { Routes } from '@angular/router';
import { MenuComponent } from './menu/menu.component';

export const SECURE_ROUTES: Routes = [
  {
    path: '',
    component: MenuComponent,
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard.page').then((m) => m.DashboardPage),
        title: 'Dashboard',
      },
      {
        path: 'balances',
        loadComponent: () => import('./balances/balances.page').then((m) => m.BalancesPage),
        title: 'Balances',
      },
      {
        path: 'settings',
        loadComponent: () => import('./settings/settings.page').then((m) => m.SettingsPage),
        title: 'Settings',
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
];
