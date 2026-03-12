import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { JwtPayload } from '@models/auth.interfaces';
import { ConfigService } from '@services/config.service';
import { SecureStorageService } from '@storage/secure.storage.service';
import { StorageService } from '@storage/storage.service';
import { jwtDecode } from 'jwt-decode';
import { AuthService } from './auth.service';

vi.mock('jwt-decode');

const mockJwtDecode = jwtDecode as ReturnType<typeof vi.fn>;

const MOCK_ADDRESS = '0xABC123';
const MOCK_ADDRESS_2 = '0xDEF456';
const MOCK_TOKEN = 'mock.jwt.token';
const MOCK_TOKEN_2 = 'mock.jwt.token2';
const MOCK_EXPIRED_TOKEN = 'mock.expired.token';

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
  token = MOCK_TOKEN,
  address = MOCK_ADDRESS,
  payload = MOCK_PAYLOAD,
) {
  mockJwtDecode.mockReturnValue(payload);
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
      mockJwtDecode.mockReturnValue(MOCK_PAYLOAD);
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
      mockJwtDecode.mockReturnValue(EXPIRED_PAYLOAD);
      secureStorageMock.get.mockResolvedValue({ [MOCK_ADDRESS]: MOCK_EXPIRED_TOKEN });

      await service.restoreSession();

      expect(service.tokens()).toEqual({});
      expect(secureStorageMock.set).toHaveBeenCalledWith('tokens', {});
    });

    it('should restore currentAddress even if its token is expired', async () => {
      mockJwtDecode.mockReturnValue(EXPIRED_PAYLOAD);
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
      mockJwtDecode.mockReturnValue(MOCK_PAYLOAD);
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
      await loginWallet(service, httpMock, MOCK_TOKEN, MOCK_ADDRESS, updatedPayload);

      expect(service.userWallets().length).toBe(1);
      expect(service.userWallets()[0].username).toBe('updated-1');
    });

    it('should not be logged in if token is already expired', async () => {
      await loginWallet(service, httpMock, MOCK_EXPIRED_TOKEN, MOCK_ADDRESS, EXPIRED_PAYLOAD);
      expect(service.isLoggedIn()).toBe(false);
    });
  });

  describe('loginWithUsername', () => {
    it('should POST to auth/login with username and password', () => {
      mockJwtDecode.mockReturnValue(MOCK_PAYLOAD);
      service.loginWithUsername('alice', 'password').subscribe();
      const req = httpMock.expectOne('http://api.test/auth/login');
      expect(req.request.body).toEqual({ username: 'alice', password: 'password' });
      req.flush({ access_token: MOCK_TOKEN });
    });

    it('should store token and set currentAddress on success', async () => {
      mockJwtDecode.mockReturnValue(MOCK_PAYLOAD);
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
      await loginWallet(service, httpMock, MOCK_TOKEN, MOCK_ADDRESS, MOCK_PAYLOAD);
      mockJwtDecode.mockReturnValue(MOCK_PAYLOAD_2);
      await loginWallet(service, httpMock, MOCK_TOKEN_2, MOCK_ADDRESS_2, MOCK_PAYLOAD_2);
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

  describe('removeUserWallet', () => {
    beforeEach(async () => {
      await loginWallet(service, httpMock, MOCK_TOKEN, MOCK_ADDRESS, MOCK_PAYLOAD);
      await loginWallet(service, httpMock, MOCK_TOKEN_2, MOCK_ADDRESS_2, MOCK_PAYLOAD_2);
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

  describe('logout', () => {
    beforeEach(async () => {
      await loginWallet(service, httpMock, MOCK_TOKEN, MOCK_ADDRESS, MOCK_PAYLOAD);
      await loginWallet(service, httpMock, MOCK_TOKEN_2, MOCK_ADDRESS_2, MOCK_PAYLOAD_2);
    });

    it('should clear currentAddress by default', async () => {
      await service.logout();
      expect(service.currentAddress()).toBeNull();
    });

    it('should keep tokens intact after logout', async () => {
      await service.logout();
      expect(service.tokens()[MOCK_ADDRESS]).toBe(MOCK_TOKEN);
      expect(service.tokens()[MOCK_ADDRESS_2]).toBe(MOCK_TOKEN_2);
    });

    it('should clear currentAddress when specific address matches', async () => {
      await service.logout(MOCK_ADDRESS_2);
      expect(service.currentAddress()).toBeNull();
    });

    it('should not clear currentAddress when specific address does not match current', async () => {
      await service.logout(MOCK_ADDRESS);
      expect(service.currentAddress()).toBe(MOCK_ADDRESS_2);
    });

    it('should do nothing if no current address and no address provided', async () => {
      service['_currentAddress'].set(null); // arrange: force null directly
      secureStorageMock.set.mockClear(); // reset call history
      await service.logout();
      expect(secureStorageMock.set).not.toHaveBeenCalled();
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
      await loginWallet(service, httpMock, MOCK_TOKEN, MOCK_ADDRESS, soonPayload);

      TestBed.tick();
      await vi.advanceTimersByTimeAsync(2000);

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.tokens()[MOCK_ADDRESS]).toBeUndefined();
      expect(service.isLoggedIn()).toBe(false);
    });

    it('should remove expired token immediately if delay is zero or negative', async () => {
      await loginWallet(service, httpMock, MOCK_EXPIRED_TOKEN, MOCK_ADDRESS, EXPIRED_PAYLOAD);

      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(service.currentAddress()).toBe(MOCK_ADDRESS);
      expect(service.tokens()[MOCK_ADDRESS]).toBeUndefined();
      expect(service.isLoggedIn()).toBe(false);
    });
  });
});
