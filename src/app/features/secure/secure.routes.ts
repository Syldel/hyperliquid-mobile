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
        title: 'Spot Balances',
      },
      {
        path: 'open-orders',
        loadComponent: () => import('./open-orders/open-orders.page').then((m) => m.OpenOrdersPage),
        title: 'Open Orders',
      },
      {
        path: 'perp-summary',
        loadComponent: () =>
          import('./perp-summary/perp-summary.page').then((m) => m.PerpSummaryPage),
        title: 'Perp Summary',
      },
      {
        path: 'bot-strategies',
        loadComponent: () =>
          import('./bot-strategies/bot-strategies.page').then((m) => m.BotStrategiesPage),
      },
      {
        path: 'settings',
        loadComponent: () => import('./settings/settings.page').then((m) => m.SettingsPage),
        title: 'Settings',
      },
      {
        path: 'profile',
        loadComponent: () => import('./profile/profile.page').then((m) => m.ProfilePage),
        title: 'Profile',
      },
      { path: '', redirectTo: 'balances', pathMatch: 'full' },
    ],
  },
];
