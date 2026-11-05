import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@auth/auth.service';
import type { ExternalUser, ExternalUserAgent } from '@syldel/trading-shared-types';
import { Observable, of, throwError } from 'rxjs';
import { AgentStatusService } from './agent-status.service';
import { AppLifecycleService } from './app-lifecycle.service';
import { UserService } from './user.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Quand l'agent se lit, et ce qui se recalcule sans réseau. Décidé avec
 * l'utilisateur le 2026-11-05 : une lecture à chaque wallet qui devient
 * connecté (connexion, restauration, changement de wallet), jamais au retour
 * au premier plan — qui ne fait que recalculer le palier depuis la date lue.
 */
describe('AgentStatusService', () => {
  let isLoggedIn: ReturnType<typeof signal<boolean>>;
  let currentAddress: ReturnType<typeof signal<string | null>>;
  let foregroundCount: ReturnType<typeof signal<number>>;
  let getMe: ReturnType<typeof vi.fn<() => Observable<ExternalUser>>>;

  const agentExpiringIn = (ms: number): ExternalUserAgent => ({
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    name: 'bot_main',
    validUntil: new Date(Date.now() + ms).toISOString(),
    keyUpdatedAt: '2026-11-05T11:05:00.000Z',
  });
  const userWith = (agent?: ExternalUserAgent) => ({ _id: 'u1', agent }) as unknown as ExternalUser;

  function create(): AgentStatusService {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoggedIn, currentAddress } },
        { provide: UserService, useValue: { getMe } },
        { provide: AppLifecycleService, useValue: { foregroundCount } },
      ],
    });
    return TestBed.inject(AgentStatusService);
  }
  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  beforeEach(() => {
    isLoggedIn = signal(false);
    currentAddress = signal<string | null>(null);
    foregroundCount = signal(0);
    getMe = vi.fn(() => of(userWith(agentExpiringIn(100 * DAY))));
  });

  afterEach(() => vi.useRealTimers());

  it('reads nothing while no wallet is signed in', async () => {
    const service = create();
    await settle();

    expect(getMe).not.toHaveBeenCalled();
    expect(service.status()).toEqual({ kind: 'loading' });
  });

  it('reads the agent once a wallet is signed in', async () => {
    const service = create();
    currentAddress.set('0xaaa');
    isLoggedIn.set(true);
    service.status();
    await settle();

    expect(getMe).toHaveBeenCalledTimes(1);
    expect(service.status()).toMatchObject({ kind: 'valid', level: 'ok', remaining: '99 d' });
  });

  it('reads again for another wallet, and only then', async () => {
    const service = create();
    currentAddress.set('0xaaa');
    isLoggedIn.set(true);
    service.status();
    await settle();

    foregroundCount.set(1);
    service.status();
    await settle();
    expect(getMe).toHaveBeenCalledTimes(1);

    currentAddress.set('0xbbb');
    service.status();
    await settle();
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  // Le palier bouge avec l'heure, sans nouvel appel.
  it('moves to a new level as time passes, without reading again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    getMe.mockReturnValue(of(userWith(agentExpiringIn(15 * DAY))));
    const service = create();
    currentAddress.set('0xaaa');
    isLoggedIn.set(true);
    service.status();
    await settle();
    expect(service.status()).toMatchObject({ level: 'ok' });

    vi.setSystemTime(Date.now() + 2 * DAY);
    foregroundCount.set(1);
    expect(service.status()).toMatchObject({ kind: 'valid', level: 'warning' });
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('reports a user without agent data as missing', async () => {
    getMe.mockReturnValue(of(userWith(undefined)));
    const service = create();
    currentAddress.set('0xaaa');
    isLoggedIn.set(true);
    service.status();
    await settle();

    expect(service.status()).toEqual({ kind: 'missing', level: 'danger' });
  });

  // Un échec de lecture se dit : « unavailable », jamais « ok » par défaut.
  it('reports a failed read as unavailable', async () => {
    getMe.mockReturnValue(throwError(() => new Error('user service down')));
    const service = create();
    currentAddress.set('0xaaa');
    isLoggedIn.set(true);
    service.status();
    await settle();

    expect(service.status()).toEqual({ kind: 'unavailable', level: 'warning' });
  });
});
