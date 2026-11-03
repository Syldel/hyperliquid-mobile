import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { JwtPayload } from '@models/auth.interfaces';
import { ConfigService } from '@services/config.service';
import { SecureStorageService } from '@storage/secure.storage.service';
import { StorageService } from '@storage/storage.service';
import { AuthService } from './auth.service';

const MOCK_ADDRESS = '0x' + 'abc123'.padEnd(40, '0');
const MOCK_ADDRESS_2 = '0x' + 'def456'.padEnd(40, '0');

const MOCK_PAYLOAD: JwtPayload = {
  sub: 'user-1',
  wallet: MOCK_ADDRESS,
  username: 'userwallet-1',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

const MOCK_PAYLOAD_2: JwtPayload = {
  sub: 'user-2',
  wallet: MOCK_ADDRESS_2,
  username: 'userwallet-2',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

const EXPIRED_PAYLOAD: JwtPayload = {
  ...MOCK_PAYLOAD,
  exp: Math.floor(Date.now() / 1000) - 100,
};

/**
 * Un vrai jeton, décodé par le vrai décodeur : rien n'est simulé entre la
 * réponse du serveur et ce que l'app range. La signature est quelconque, l'app
 * ne la vérifie pas (voir jwt-payload.ts).
 */
function tokenOf(payload: object): string {
  const b64url = (text: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(text)))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.c2lnbmF0dXJl`;
}

const MOCK_TOKEN = tokenOf(MOCK_PAYLOAD);
const MOCK_TOKEN_2 = tokenOf(MOCK_PAYLOAD_2);
const MOCK_EXPIRED_TOKEN = tokenOf(EXPIRED_PAYLOAD);

function createStorageMock() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function createSecureStorageMock() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

async function loginWallet(
  service: AuthService,
  httpMock: HttpTestingController,
  payload: JwtPayload = MOCK_PAYLOAD,
) {
  const token = tokenOf(payload);
  const address = payload.wallet;
  const promise = new Promise<void>((resolve) => {
    service.loginWithWallet(address, 'password').subscribe(() => resolve());
  });
  httpMock.expectOne(`http://api.test/auth/login`).flush({ access_token: token });
  await promise;
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let storageMock: ReturnType<typeof createStorageMock>;
  let secureStorageMock: ReturnType<typeof createSecureStorageMock>;

  beforeEach(() => {
    storageMock = createStorageMock();
    secureStorageMock = createSecureStorageMock();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: StorageService, useValue: storageMock },
        { provide: SecureStorageService, useValue: secureStorageMock },
        { provide: ConfigService, useValue: { userServiceUrl: 'http://api.test' } },
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.clearAllMocks();
  });

  describe('Initial state', () => {
    it('should have empty tokens map', () => {
      expect(service.tokens()).toEqual({});
    });

    it('should have empty userWallets', () => {
      expect(service.userWallets()).toEqual([]);
    });

    it('should have null currentAddress', () => {
      expect(service.currentAddress()).toBeNull();
    });

    it('should not be logged in', () => {
      expect(service.isLoggedIn()).toBe(false);
    });

    it('should have null currentToken', () => {
      expect(service.currentToken()).toBeNull();
    });

    it('should have null currentWallet', () => {
      expect(service.currentWallet()).toBeNull();
    });
  });

  describe('restoreSession', () => {
    it('should set ready$ to true after restore', async () => {
      await service.restoreSession();
      expect(service.ready$.value).toBe(true);
    });

    it('should set ready$ to true even if restore throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      storageMock.get.mockRejectedValue(new Error('storage error'));
      await service.restoreSession();
      expect(service.ready$.value).toBe(true);
    });

    it('should restore valid token and set currentAddress', async () => {
      storageMock.get.mockImplementation((key: string) => {
        if (key === 'userWallets') return Promise.resolve([MOCK_PAYLOAD]);
        if (key === 'currentAddress') return Promise.resolve(MOCK_ADDRESS);
        return Promise.resolve(null);
      });
      secureStorageMock.get.mockResolvedValue({ [MOCK_ADDRESS]: MOCK_TOKEN });

      await service.restoreSession();

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.currentToken()).toBe(MOCK_TOKEN);
    });

    it('should purge expired tokens on restore', async () => {
      secureStorageMock.get.mockResolvedValue({ [MOCK_ADDRESS]: MOCK_EXPIRED_TOKEN });

      await service.restoreSession();

      expect(service.tokens()).toEqual({});
      expect(secureStorageMock.set).toHaveBeenCalledWith('tokens', {});
    });

    it('should restore currentAddress even if its token is expired', async () => {
      storageMock.get.mockImplementation((key: string) => {
        if (key === 'currentAddress') return Promise.resolve(MOCK_ADDRESS);
        return Promise.resolve(null);
      });
      secureStorageMock.get.mockResolvedValue({ [MOCK_ADDRESS]: MOCK_EXPIRED_TOKEN });

      await service.restoreSession();

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.isLoggedIn()).toBe(false);
    });

    it('should restore userWallets from storage', async () => {
      storageMock.get.mockImplementation((key: string) => {
        if (key === 'userWallets') return Promise.resolve([MOCK_PAYLOAD]);
        return Promise.resolve(null);
      });

      await service.restoreSession();

      expect(service.userWallets()).toEqual([MOCK_PAYLOAD]);
    });

    it('should restore currentAddress even if stored address has no valid token', async () => {
      storageMock.get.mockImplementation((key: string) => {
        if (key === 'currentAddress') return Promise.resolve(MOCK_ADDRESS);
        return Promise.resolve(null);
      });
      secureStorageMock.get.mockResolvedValue(null);

      await service.restoreSession();

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.isLoggedIn()).toBe(false);
    });
  });

  describe('loginWithWallet', () => {
    it('should POST to auth/login with walletAddress and password', async () => {
      service.loginWithWallet(MOCK_ADDRESS, 'password').subscribe();
      const req = httpMock.expectOne('http://api.test/auth/login');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ walletAddress: MOCK_ADDRESS, password: 'password' });
      req.flush({ access_token: MOCK_TOKEN });
    });

    it('should store token and set currentAddress on success', async () => {
      await loginWallet(service, httpMock);
      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.currentToken()).toBe(MOCK_TOKEN);
      expect(secureStorageMock.set).toHaveBeenCalledWith('tokens', { [MOCK_ADDRESS]: MOCK_TOKEN });
    });

    it('should add wallet to userWallets on first login', async () => {
      await loginWallet(service, httpMock);
      expect(service.userWallets()).toContainEqual(MOCK_PAYLOAD);
    });

    it('should upsert wallet on subsequent login with same address', async () => {
      await loginWallet(service, httpMock);

      const updatedPayload = { ...MOCK_PAYLOAD, username: 'updated-1' };
      await loginWallet(service, httpMock, updatedPayload);

      expect(service.userWallets().length).toBe(1);
      expect(service.userWallets()[0].username).toBe('updated-1');
    });

    it('should not be logged in if token is already expired', async () => {
      await loginWallet(service, httpMock, EXPIRED_PAYLOAD);
      expect(service.isLoggedIn()).toBe(false);
    });
  });

  // Le décodeur valide la forme du jeton : un jeton sans `exp` n'entre plus
  // dans les wallets (il n'aurait jamais passé pour expiré).
  it('should refuse a token without exp, and store nothing', async () => {
    const { exp: _exp, ...withoutExp } = MOCK_PAYLOAD;
    const outcome = new Promise<unknown>((resolve) =>
      service.loginWithWallet(MOCK_ADDRESS, 'password').subscribe({
        next: () => resolve('ok'),
        error: (e: unknown) => resolve(e),
      }),
    );
    httpMock.expectOne('http://api.test/auth/login').flush({ access_token: tokenOf(withoutExp) });

    expect(await outcome).toEqual(
      new Error('Invalid sign-in token: "exp" is missing or malformed'),
    );
    expect(service.userWallets()).toEqual([]);
    expect(service.currentAddress()).toBeNull();
    expect(secureStorageMock.set).not.toHaveBeenCalled();
  });

  describe('loginWithUsername', () => {
    it('should POST to auth/login with username and password', () => {
      service.loginWithUsername('alice', 'password').subscribe();
      const req = httpMock.expectOne('http://api.test/auth/login');
      expect(req.request.body).toEqual({ username: 'alice', password: 'password' });
      req.flush({ access_token: MOCK_TOKEN });
    });

    it('should store token and set currentAddress on success', async () => {
      const promise = new Promise<void>((resolve) => {
        service.loginWithUsername('alice', 'password').subscribe(() => resolve());
      });
      httpMock.expectOne('http://api.test/auth/login').flush({ access_token: MOCK_TOKEN });
      await promise;

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.currentToken()).toBe(MOCK_TOKEN);
    });
  });

  describe('chooseUserWallet', () => {
    beforeEach(async () => {
      await loginWallet(service, httpMock, MOCK_PAYLOAD);
      await loginWallet(service, httpMock, MOCK_PAYLOAD_2);
    });

    it('should switch currentAddress to chosen wallet', async () => {
      await service.chooseUserWallet(MOCK_ADDRESS);
      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
    });

    it('should update currentToken when switching wallet', async () => {
      await service.chooseUserWallet(MOCK_ADDRESS);
      expect(service.currentToken()).toBe(MOCK_TOKEN);

      await service.chooseUserWallet(MOCK_ADDRESS_2);
      expect(service.currentToken()).toBe(MOCK_TOKEN_2);
    });

    it('should persist chosen address to storage', async () => {
      await service.chooseUserWallet(MOCK_ADDRESS);
      expect(storageMock.set).toHaveBeenCalledWith('currentAddress', MOCK_ADDRESS);
    });

    it('should do nothing if wallet address does not exist', async () => {
      await service.chooseUserWallet('0xUNKNOWN');
      expect(service.currentAddress()).toBe(MOCK_ADDRESS_2);
    });
  });

  /**
   * Une restauration qui échoue laisse les signaux vides, et vide n'est pas
   * « rien à restaurer ». Écrire à partir de cet état remplacerait les jetons et
   * les wallets stockés par une table à un seul élément.
   */
  describe('a session restore that failed', () => {
    const outcomeOfLogin = (token = MOCK_TOKEN) => {
      const outcome = new Promise<unknown>((resolve) =>
        service.loginWithWallet(MOCK_ADDRESS, 'password').subscribe({
          next: () => resolve('ok'),
          error: (e) => resolve(e),
        }),
      );
      httpMock.expectOne('http://api.test/auth/login').flush({ access_token: token });
      return outcome;
    };

    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      secureStorageMock.get.mockRejectedValue(new Error('keychain locked'));
    });

    it('is reported, and clears once a later restore succeeds', async () => {
      await service.restoreSession();
      expect(service.restoreFailed()).toBe(true);

      secureStorageMock.get.mockResolvedValue(null);
      await service.restoreSession();

      expect(service.restoreFailed()).toBe(false);
    });

    it('refuses a login rather than overwrite the stored tokens and wallets', async () => {
      await service.restoreSession();
      secureStorageMock.set.mockClear();
      storageMock.set.mockClear();

      const result = await outcomeOfLogin();

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/will not be overwritten/);
      expect(secureStorageMock.set).not.toHaveBeenCalled();
      expect(storageMock.set).not.toHaveBeenCalled();
      expect(service.currentAddress()).toBeNull();
      expect(service.tokens()).toEqual({});
    });

    it('retries the restore before refusing, since the failure is often passing', async () => {
      await service.restoreSession();
      expect(service.restoreFailed()).toBe(true);
      secureStorageMock.get.mockResolvedValue(null);

      const result = await outcomeOfLogin();

      expect(result).toBe('ok');
      expect(service.restoreFailed()).toBe(false);
      expect(secureStorageMock.set).toHaveBeenCalledWith('tokens', { [MOCK_ADDRESS]: MOCK_TOKEN });
    });

    it('keeps refusing when the retry reads the wallets but the keychain still fails', async () => {
      storageMock.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'userWallets' ? [MOCK_PAYLOAD_2] : null),
      );
      await service.restoreSession();
      secureStorageMock.set.mockClear();

      const result = await outcomeOfLogin();

      expect(result).toBeInstanceOf(Error);
      expect(secureStorageMock.set).not.toHaveBeenCalled();
    });

    it('refuses to remove a wallet, which would also rewrite the token table', async () => {
      await service.restoreSession();
      secureStorageMock.set.mockClear();
      storageMock.set.mockClear();

      await expect(service.removeUserWallet(MOCK_ADDRESS)).rejects.toThrow(
        /will not be overwritten/,
      );

      expect(secureStorageMock.set).not.toHaveBeenCalled();
      expect(storageMock.set).not.toHaveBeenCalled();
    });

    it('also holds when the plain storage is what failed', async () => {
      secureStorageMock.get.mockResolvedValue(null);
      storageMock.get.mockRejectedValue(new Error('preferences unavailable'));
      await service.restoreSession();

      expect(service.restoreFailed()).toBe(true);
    });
  });

  describe('removeUserWallet', () => {
    beforeEach(async () => {
      await loginWallet(service, httpMock, MOCK_PAYLOAD);
      await loginWallet(service, httpMock, MOCK_PAYLOAD_2);
    });

    it('should remove wallet from userWallets', async () => {
      await service.removeUserWallet(MOCK_ADDRESS);
      expect(service.userWallets().find((w) => w.wallet === MOCK_ADDRESS)).toBeUndefined();
    });

    it('should remove token from tokens map', async () => {
      await service.removeUserWallet(MOCK_ADDRESS);
      expect(service.tokens()[MOCK_ADDRESS]).toBeUndefined();
    });

    it('should set currentAddress to null if current wallet is removed', async () => {
      await service.chooseUserWallet(MOCK_ADDRESS_2);
      await service.removeUserWallet(MOCK_ADDRESS_2);
      expect(service.currentAddress()).toBeNull();
    });

    it('should persist updated tokens to secure storage', async () => {
      await service.removeUserWallet(MOCK_ADDRESS);
      expect(secureStorageMock.set).toHaveBeenCalledWith('tokens', {
        [MOCK_ADDRESS_2]: MOCK_TOKEN_2,
      });
    });

    it('should persist updated userWallets to storage', async () => {
      await service.removeUserWallet(MOCK_ADDRESS);
      expect(storageMock.set).toHaveBeenCalledWith(
        'userWallets',
        expect.not.arrayContaining([expect.objectContaining({ wallet: MOCK_ADDRESS })]),
      );
    });
  });

  describe('switchWallet', () => {
    beforeEach(async () => {
      await loginWallet(service, httpMock, MOCK_PAYLOAD);
      await loginWallet(service, httpMock, MOCK_PAYLOAD_2);
    });

    it('should clear currentAddress by default', async () => {
      await service.switchWallet();
      expect(service.currentAddress()).toBeNull();
    });

    it('should keep tokens intact after switching wallet', async () => {
      await service.switchWallet();
      expect(service.tokens()[MOCK_ADDRESS]).toBe(MOCK_TOKEN);
      expect(service.tokens()[MOCK_ADDRESS_2]).toBe(MOCK_TOKEN_2);
    });

    it('should clear currentAddress when specific address matches', async () => {
      await service.switchWallet(MOCK_ADDRESS_2);
      expect(service.currentAddress()).toBeNull();
    });

    it('should not clear currentAddress when specific address does not match current', async () => {
      await service.switchWallet(MOCK_ADDRESS);
      expect(service.currentAddress()).toBe(MOCK_ADDRESS_2);
    });

    it('should do nothing if no current address and no address provided', async () => {
      service['_currentAddress'].set(null); // arrange: force null directly
      secureStorageMock.set.mockClear(); // reset call history
      await service.switchWallet();
      expect(secureStorageMock.set).not.toHaveBeenCalled();
    });
  });

  describe('signOut', () => {
    beforeEach(async () => {
      await loginWallet(service, httpMock, MOCK_PAYLOAD);
      await loginWallet(service, httpMock, MOCK_PAYLOAD_2);
    });

    // Le « Logout » d'avant gardait le jeton : valide jusqu'à une heure de plus.
    it('should delete the token of the current wallet, in memory and in secure storage', async () => {
      await service.signOut();

      expect(service.tokens()[MOCK_ADDRESS_2]).toBeUndefined();
      expect(secureStorageMock.set).toHaveBeenLastCalledWith('tokens', {
        [MOCK_ADDRESS]: MOCK_TOKEN,
      });
    });

    it("should keep the other wallets' tokens", async () => {
      await service.signOut();
      expect(service.tokens()[MOCK_ADDRESS]).toBe(MOCK_TOKEN);
    });

    it('should keep the wallet in the list, and go back to it', async () => {
      await service.signOut();

      expect(service.currentAddress()).toBeNull();
      expect(service.userWallets().map((w) => w.wallet)).toContain(MOCK_ADDRESS_2);
    });

    // Rouvert, le wallet se consulte sans jeton : il ne doit pas passer pour
    // connecté, alors que sa charge garde un `exp` futur.
    it('should not count a reopened signed-out wallet as logged in', async () => {
      await service.signOut();
      await service.chooseUserWallet(MOCK_ADDRESS_2);

      expect(service.currentAddress()).toBe(MOCK_ADDRESS_2);
      expect(service.currentToken()).toBeNull();
      expect(service.isLoggedIn()).toBe(false);
    });

    it('should refuse to write when the stored session could not be read', async () => {
      service['_restoreError'].set(new Error('keychain locked'));
      secureStorageMock.get.mockRejectedValue(new Error('keychain locked'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      secureStorageMock.set.mockClear();

      await expect(service.signOut()).rejects.toThrow('could not be read');
      expect(secureStorageMock.set).not.toHaveBeenCalled();
    });
  });

  /**
   * L'expiration se lit dans le jeton stocké, jamais dans la copie de sa
   * charge rangée dans `userWallets` : après « Sign out », la copie gardait un
   * `exp` futur et le profil affichait « Valid » pour un jeton absent.
   */
  describe('the token is the authority on expiry', () => {
    beforeEach(async () => {
      await loginWallet(service, httpMock, MOCK_PAYLOAD);
    });

    it('should read the expiry from the stored token', () => {
      expect(service.currentTokenExp()).toBe(MOCK_PAYLOAD.exp);
    });

    it('should have no expiry once signed out, whatever the stored copy says', async () => {
      await service.signOut();
      await service.chooseUserWallet(MOCK_ADDRESS);

      expect(service.currentWallet()?.exp).toBe(MOCK_PAYLOAD.exp);
      expect(service.currentTokenExp()).toBeNull();
      expect(service.isLoggedIn()).toBe(false);
    });

    it('should ignore the stored copy when it disagrees with the token', () => {
      service['_userWallets'].update((wallets) =>
        wallets.map((w) => ({ ...w, exp: Math.floor(Date.now() / 1000) - 100 })),
      );

      expect(service.isLoggedIn()).toBe(true);
    });

    it('should ignore, and report, a stored token that cannot be read', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      service['_tokens'].set({ [MOCK_ADDRESS]: 'not.a.token' });

      expect(service.currentTokenExp()).toBeNull();
      expect(service.isLoggedIn()).toBe(false);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('is unreadable'),
        expect.anything(),
      );
    });

    it('should ignore a token stored under another wallet than its own', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      service['_tokens'].set({ [MOCK_ADDRESS]: MOCK_TOKEN_2 });

      expect(service.currentTokenExp()).toBeNull();
    });

    // Le modèle de session : un wallet de la liste s'ouvre avec ou sans jeton.
    it('should open a wallet whose token has expired, and drop that token', async () => {
      await loginWallet(service, httpMock, MOCK_PAYLOAD_2);
      service['_tokens'].update((tokens) => ({ ...tokens, [MOCK_ADDRESS]: MOCK_EXPIRED_TOKEN }));

      await service.chooseUserWallet(MOCK_ADDRESS);

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.tokens()[MOCK_ADDRESS]).toBeUndefined();
      expect(service.isLoggedIn()).toBe(false);
    });
  });

  describe('setupAutoLogout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should remove expired token but keep currentAddress when token expires', async () => {
      const soonPayload = { ...MOCK_PAYLOAD, exp: Math.floor(Date.now() / 1000) + 2 };
      await loginWallet(service, httpMock, soonPayload);

      TestBed.tick();
      await vi.advanceTimersByTimeAsync(2000);

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.tokens()[MOCK_ADDRESS]).toBeUndefined();
      expect(service.isLoggedIn()).toBe(false);
    });

    it('should remove expired token immediately if delay is zero or negative', async () => {
      await loginWallet(service, httpMock, EXPIRED_PAYLOAD);

      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.tokens()[MOCK_ADDRESS]).toBeUndefined();
      expect(service.isLoggedIn()).toBe(false);
    });
  });
});
