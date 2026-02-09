import { HttpClient } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';

import { Router } from '@angular/router';
import { UserWallet } from '@models/wallet/user-wallet.interfaces';
import { SecureStorageService } from '@storage/secure.storage.service';
import { StorageService } from '@storage/storage.service';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _userWallets = signal<UserWallet[] | null>([]);
  private readonly _currentUser = signal<UserWallet | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly userWallets = this._userWallets.asReadonly();
  readonly currentUser = this._currentUser.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly ready$ = new BehaviorSubject(false);

  // TODO: consider this.isTokenExpired()
  readonly isLoggedIn = computed(() => !!this._currentUser());

  constructor(
    private readonly http: HttpClient,
    private readonly storage: StorageService,
    private readonly secureStorage: SecureStorageService,
    private readonly router: Router,
  ) {
    this.restoreSession();
  }

  async restoreSession() {
    try {
      const [userWallets, currentUser] = await Promise.all([
        this.storage.get<UserWallet[]>('userWallets'),
        this.storage.get<UserWallet>('currentUser'),
      ]);

      this._userWallets.set(userWallets);
      this._currentUser.set(currentUser);

      this.ready$.next(true);
    } catch (err) {
      console.error('Error restoring session', err);
      this.ready$.next(true);
    }
  }

  // Méthode pour ajouter un wallet (exemple)
  addUserWallet(wallet: UserWallet): void {
    this._userWallets.update((current) => [...(current || []), wallet]);
    this.storage.set('userWallets', this._userWallets());
  }

  async login(payload: { publicAddress: string }) {
    this._loading.set(true);
    this._error.set(null);

    try {
      // const res = await firstValueFrom(
      //   this.http.post<any>(`${environment.apiBaseUrl}/login`, payload, {
      //     headers: { 'Content-Type': 'application/json' },
      //   }),
      // );
      const res = {
        token: 'fake',
        user: {},
      };

      this._currentUser.set({
        name: 'fake',
        wallet: { publicAddress: payload.publicAddress },
        user: {},
        token: 'fake',
      });

      await this.secureStorage.set('currentUser', this.currentUser());

      return res;
    } catch {
      this._error.set('Login failed. Please check your credentials.');
    } finally {
      this._loading.set(false);
    }
    return;
  }

  async logout() {
    this._currentUser.set(null);

    await this.router.navigate(['/auth/login']);
  }
}
