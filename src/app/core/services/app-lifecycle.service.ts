import { Injectable, signal } from '@angular/core';
import { App as CapacitorApp } from '@capacitor/app';

@Injectable({ providedIn: 'root' })
export class AppLifecycleService {
  private readonly _isActive = signal(true);
  private readonly _foregroundCount = signal(0);

  readonly isActive = this._isActive.asReadonly();

  readonly foregroundCount = this._foregroundCount.asReadonly();

  constructor() {
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      this._isActive.set(isActive);
      if (isActive) this._foregroundCount.update((n) => n + 1);
    });
  }
}
