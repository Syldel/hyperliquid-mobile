import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { AuthResponse, JwtPayload, TokenMap } from '@models/auth.interfaces';
import { ConfigService } from '@services/config.service';
import { SecureStorageService } from '@storage/secure.storage.service';
import { StorageService } from '@storage/storage.service';
import { jwtDecode } from 'jwt-decode';
import { BehaviorSubject, from, switchMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(StorageService);
  private readonly secureStorage = inject(SecureStorageService);
  private readonly config = inject(ConfigService);

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_TIMEOUT = 2_147_483_647;

  // --- State ---
  private readonly _tokens = signal<TokenMap>({});
  private readonly _userWallets = signal<JwtPayload[]>([]);
  private readonly _currentAddress = signal<string | null>(null);

  // --- Public readonly ---
  readonly tokens = this._tokens.asReadonly();
  readonly userWallets = this._userWallets.asReadonly();
  readonly currentAddress = this._currentAddress.asReadonly();

  // --- Derived ---
  readonly currentWallet = computed(() => {
    const address = this._currentAddress();
    if (!address) return null;
    return this._userWallets().find((w) => w.wallet === address) ?? null;
  });

  readonly currentToken = computed(() => {
    const address = this._currentAddress();
    if (!address) return null;
    return this._tokens()[address] ?? null;
  });

  readonly isLoggedIn = computed(() => {
    this._tokens(); // dépendance silencieuse

    const address = this._currentAddress();
    if (!address) return false;

    const payload = this._userWallets().find((p) => p.wallet === address);
    if (!payload) return false;

    return payload.exp > Date.now() / 1000;
  });

  readonly ready$ = new BehaviorSubject(false);

  constructor() {
    this.setupAutoLogout();
    this.restoreSession();
  }

  // --- Session restore ---

  async restoreSession(): Promise<void> {
    try {
      const [userWallets, tokenMap, currentAddress] = await Promise.all([
        this.storage.get<JwtPayload[]>('userWallets'),
        this.secureStorage.get<TokenMap>('tokens'),
        this.storage.get<string>('currentAddress'),
      ]);

      if (userWallets) this._userWallets.set(userWallets);

      if (tokenMap) {
        const validTokens = this.purgeExpiredTokens(tokenMap);
        this._tokens.set(validTokens);
        await this.secureStorage.set('tokens', validTokens);
      }

      this._currentAddress.set(currentAddress);
    } catch (err) {
      console.error('Error restoring session', err);
    } finally {
      this.ready$.next(true);
    }
  }

  // --- Login ---

  loginWithWallet(walletAddress: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.config.userServiceUrl}/auth/login`, { walletAddress, password })
      .pipe(switchMap((res) => from(this.handleAuthResponse(res))));
  }

  loginWithUsername(username: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.config.userServiceUrl}/auth/login`, { username, password })
      .pipe(switchMap((res) => from(this.handleAuthResponse(res))));
  }

  private async handleAuthResponse({ access_token }: AuthResponse): Promise<void> {
    const payload = jwtDecode<JwtPayload>(access_token);

    const address = payload.wallet;

    // Mettre à jour le token map
    this._tokens.update((tokens) => ({ ...tokens, [address]: access_token }));
    await this.secureStorage.set('tokens', this._tokens());

    // Mettre à jour ou ajouter le wallet
    await this.upsertUserWallet(payload);

    // Définir comme wallet courant
    this._currentAddress.set(address);
    await this.storage.set('currentAddress', address);
  }

  // --- Wallet management ---

  async chooseUserWallet(walletAddress: string): Promise<void> {
    const delay = this.removeTokenIfExpired(walletAddress);
    if (!delay) return;

    this._currentAddress.set(walletAddress);
    await this.storage.set('currentAddress', walletAddress);
  }

  async removeUserWallet(walletAddress: string): Promise<void> {
    this._userWallets.update((wallets) => wallets.filter((w) => w.wallet !== walletAddress));
    this._tokens.update(({ [walletAddress]: _, ...rest }) => rest);

    await Promise.all([
      this.storage.set('userWallets', this._userWallets()),
      this.secureStorage.set('tokens', this._tokens()),
    ]);

    if (this._currentAddress() === walletAddress) {
      this._currentAddress.set(null);
      await this.storage.set('currentAddress', null);
    }
  }

  // --- Logout ---

  async logout(walletAddress?: string): Promise<void> {
    const target = walletAddress ?? this._currentAddress();
    if (!target) return;

    // this._tokens.update(({ [target]: _, ...rest }) => rest);
    // await this.secureStorage.set('tokens', this._tokens());

    if (this._currentAddress() === target) {
      this._currentAddress.set(null);
      await this.storage.set('currentAddress', null);
    }
  }

  removeTokenIfExpired(address: string): number | null {
    const payload = this._userWallets().find((p) => p.wallet === address);
    if (!payload) return null;

    const delay = payload.exp * 1000 - Date.now();
    if (delay <= 0) {
      this.removeToken(address);
    }

    return delay;
  }

  // --- Private helpers ---

  private removeToken(address: string): void {
    this._tokens.update((tokens) => {
      const updated = { ...tokens };
      delete updated[address];
      return updated;
    });
  }

  private async upsertUserWallet(payload: JwtPayload): Promise<void> {
    let merged = false;

    const updated = this._userWallets().map((w) => {
      if (w.wallet === payload.wallet) {
        merged = true;
        return { ...w, ...payload };
      }
      return w;
    });

    this._userWallets.set(merged ? updated : [...updated, payload]);
    await this.storage.set('userWallets', this._userWallets());
  }

  private purgeExpiredTokens(tokenMap: TokenMap): TokenMap {
    const now = Date.now() / 1000;

    return Object.fromEntries(
      Object.entries(tokenMap).filter(([address]) => {
        const payload = this._userWallets().find((p) => p.wallet === address);
        return payload && payload.exp > now;
      }),
    );
  }

  private setupAutoLogout(): void {
    effect((onCleanup) => {
      const address = this._currentAddress();

      onCleanup(() => {
        if (this.timeoutId) clearTimeout(this.timeoutId);
      });

      if (!address) return;

      this.scheduleAutoLogout(address);
    });
  }

  public scheduleAutoLogout(address = this._currentAddress()): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (!address) return;

    const delay = this.removeTokenIfExpired(address);
    if (delay === null || delay <= 0) return;

    this.timeoutId = setTimeout(() => this.removeToken(address), Math.min(delay, this.MAX_TIMEOUT));
  }
}
