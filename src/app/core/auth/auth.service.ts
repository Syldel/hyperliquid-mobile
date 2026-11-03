import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { AuthResponse, JwtPayload, TokenMap } from '@models/auth.interfaces';
import { ConfigService } from '@services/config.service';
import { SecureStorageService } from '@storage/secure.storage.service';
import { StorageService } from '@storage/storage.service';
import { BehaviorSubject, from, switchMap } from 'rxjs';
import { decodeJwtPayload } from './jwt-payload';

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

  /**
   * L'expiration du jeton du wallet courant, en secondes, **lue dans le jeton
   * stocké** ; `null` sans jeton.
   *
   * Le jeton fait foi, pas la copie de sa charge rangée dans `userWallets` à la
   * connexion. Les deux restaient d'accord tant qu'un jeton n'était supprimé
   * qu'à son expiration ; `signOut` le supprime avant, et le profil affichait
   * « Valid, 54m remaining » à côté de « Sign in again » pour un jeton absent
   * (mesuré le 2026-11-03). `userWallets` ne sert plus qu'à l'identité.
   */
  readonly currentTokenExp = computed(() => {
    const address = this._currentAddress();
    return address ? this.tokenExp(address) : null;
  });

  readonly isLoggedIn = computed(() => {
    const exp = this.currentTokenExp();
    return exp !== null && exp > Date.now() / 1000;
  });

  readonly ready$ = new BehaviorSubject(false);

  /**
   * Pourquoi la dernière restauration a échoué, ou `null` si elle a réussi.
   *
   * Un échec laisse les signaux **vides**, et vide n'est pas « rien à restaurer » :
   * la connexion suivante réécrivait alors la table des jetons et la liste des
   * wallets à partir de cet état, effaçant ceux des autres wallets dès que le
   * trousseau redevenait lisible. Tant que ceci n'est pas `null`, plus aucune
   * écriture dérivée de l'état en mémoire n'a lieu (`assertSessionRestored`).
   */
  private readonly _restoreError = signal<unknown>(null);
  readonly restoreFailed = computed(() => this._restoreError() !== null);

  constructor() {
    this.setupAutoLogout();
    this.restoreSession();
  }

  // --- Session restore ---

  async restoreSession(): Promise<void> {
    this._restoreError.set(null);
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
      this._restoreError.set(err);
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

  /**
   * Refuse d'écrire tant que ce qui est stocké n'a pas pu être lu.
   *
   * Une restauration ratée (trousseau verrouillé, stockage illisible) est
   * retentée une fois — l'échec est souvent passager. Si elle échoue encore, on
   * lève : écrire maintenant, c'est remplacer ce qui est stocké par un état
   * vide que l'on prendrait pour la vérité.
   */
  private async assertSessionRestored(): Promise<void> {
    if (!this.restoreFailed()) return;

    await this.restoreSession();
    if (this.restoreFailed()) {
      throw new Error(
        'Stored sign-in data could not be read, so it will not be overwritten. Restart the app, or unlock the device keychain, and try again.',
      );
    }
  }

  private async handleAuthResponse({ access_token }: AuthResponse): Promise<void> {
    await this.assertSessionRestored();
    const payload = decodeJwtPayload(access_token);

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

  /**
   * Ouvre un wallet de la liste, avec ou sans jeton valide : c'est le modèle de
   * session (docs/ecosystem.md, une adresse mémorisée, un jeton optionnel). Un
   * jeton expiré est supprimé au passage.
   *
   * Le choix dépendait de l'expiration de la copie dans `userWallets` : un
   * wallet au jeton expiré ne s'ouvrait pas, et l'écran gardait le précédent.
   */
  async chooseUserWallet(walletAddress: string): Promise<void> {
    if (!this._userWallets().some((w) => w.wallet === walletAddress)) return;

    this.removeTokenIfExpired(walletAddress);
    this._currentAddress.set(walletAddress);
    await this.storage.set('currentAddress', walletAddress);
  }

  async removeUserWallet(walletAddress: string): Promise<void> {
    await this.assertSessionRestored();
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

  // --- Changer de wallet, se déconnecter ---
  //
  // Deux gestes distincts (docs/ecosystem.md, le modèle de session : une
  // adresse mémorisée, un jeton optionnel). L'unique « Logout » faisait le
  // premier : il oubliait l'adresse mais gardait le jeton, valide jusqu'à une
  // heure sur le téléphone, alors que le menu annonçait une déconnexion.

  /**
   * Revient à la liste des wallets en gardant leurs jetons : rouvrir le même
   * wallet ne redemande pas le mot de passe tant que son jeton est valide.
   */
  async switchWallet(walletAddress?: string): Promise<void> {
    const target = walletAddress ?? this._currentAddress();
    if (!target) return;

    if (this._currentAddress() === target) {
      this._currentAddress.set(null);
      await this.storage.set('currentAddress', null);
    }
  }

  /**
   * Supprime le jeton du wallet courant, puis revient à la liste. Le wallet y
   * reste : rouvert, il se consulte sans jeton (l'API publique suffit), et ce
   * qui exige une authentification redemande le mot de passe.
   */
  async signOut(): Promise<void> {
    const target = this._currentAddress();
    if (!target) return;

    await this.assertSessionRestored();
    this.removeToken(target);
    await this.secureStorage.set('tokens', this._tokens());

    this._currentAddress.set(null);
    await this.storage.set('currentAddress', null);
  }

  removeTokenIfExpired(address: string): number | null {
    const exp = this.tokenExp(address);
    if (exp === null) return null;

    const delay = exp * 1000 - Date.now();
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
      Object.entries(tokenMap).filter(([address, token]) => {
        const exp = expiryOf(address, token);
        return exp !== null && exp > now;
      }),
    );
  }

  /** L'expiration du jeton stocké pour `address`, ou `null` sans jeton lisible. */
  private tokenExp(address: string): number | null {
    const token = this._tokens()[address];
    return token ? expiryOf(address, token) : null;
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

/**
 * L'expiration d'un jeton stocké, s'il se lit et appartient bien au wallet
 * sous lequel il est rangé ; `null` sinon, en le disant : un jeton illisible ou
 * rangé sous la mauvaise adresse ne compte pas comme une session.
 */
function expiryOf(address: string, token: string): number | null {
  try {
    const payload = decodeJwtPayload(token);
    if (payload.wallet.toLowerCase() !== address.toLowerCase()) {
      console.error(`Stored token for ${address} belongs to ${payload.wallet}; ignored.`);
      return null;
    }
    return payload.exp;
  } catch (err) {
    console.error(`Stored token for ${address} is unreadable; ignored.`, err);
    return null;
  }
}
