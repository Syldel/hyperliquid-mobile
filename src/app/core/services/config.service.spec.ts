import { TestBed } from '@angular/core/testing';
import { AppConfig } from '@models/app-config.interface';
import { StorageService } from '@storage/storage.service';
import { environment } from 'environments/environment';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from './config.service';

/**
 * ============================================================================
 * Les quatre URL dont tout le reste dépend.
 *
 * Une URL fausse ne casse rien bruyamment : les appels partent ailleurs, ou
 * nulle part, et l'écran dit « indisponible ». D'où ce qui est épinglé ici :
 * quelle valeur fait autorité (le storage, sinon le défaut du build), et qu'un
 * enregistrement raté ne laisse pas l'app croire à une config qu'elle n'a pas
 * écrite.
 *
 * Une config stockée **incomplète** (un champ ajouté depuis à `AppConfig`) se
 * complète champ par champ depuis le défaut du build, en le disant ; une config
 * **corrompue** ne s'applique pas. Avant le 2026-10-15 elle remplaçait le défaut
 * en entier, et le champ manquant se lisait `undefined` — d'où des requêtes
 * vers `undefined/auth/me`, sans aucune erreur.
 * ============================================================================
 */
describe('ConfigService', () => {
  let service: ConfigService;
  let store: Map<string, unknown>;
  let failWrites: boolean;

  const stored: AppConfig = {
    userServiceUrl: 'http://stored-user',
    hyperliquidPublicUrl: 'http://stored-public',
    hyperliquidGatewayUrl: 'http://stored-gateway',
    botServiceUrl: 'http://stored-bot',
  };

  beforeEach(() => {
    store = new Map();
    failWrites = false;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: StorageService,
          useValue: {
            get: async (key: string) => (store.has(key) ? structuredClone(store.get(key)) : null),
            set: async (key: string, value: unknown) => {
              if (failWrites) throw new Error('disk full');
              store.set(key, structuredClone(value));
            },
          },
        },
      ],
    });
    service = TestBed.inject(ConfigService);
  });

  describe('before anything was loaded', () => {
    it('starts from the build default, so a fresh browser needs no setup', () => {
      expect(service.getConfig()).toEqual(environment.defaultConfig);
    });

    it('does not share the default object with the environment', () => {
      expect(service.getConfig()).not.toBe(environment.defaultConfig);
    });
  });

  describe('loadConfig', () => {
    it('keeps the build default when nothing is stored', async () => {
      expect(await service.loadConfig()).toEqual(environment.defaultConfig);
    });

    it('lets the stored configuration win over the build default', async () => {
      store.set('app_hl_config', stored);

      expect(await service.loadConfig()).toEqual(stored);
      expect(service.botServiceUrl).toBe('http://stored-bot');
    });

    it('publishes the stored configuration to subscribers', async () => {
      store.set('app_hl_config', stored);
      await service.loadConfig();

      expect(await firstValueFrom(service.config$)).toEqual(stored);
    });
  });

  describe('loadConfig with a stored configuration that is not what this build expects', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    it('fills a missing field from the build default instead of leaving it undefined', async () => {
      const { botServiceUrl: _omitted, ...incomplete } = stored;
      store.set('app_hl_config', incomplete);

      const config = await service.loadConfig();

      expect(config.botServiceUrl).toBe(environment.defaultConfig.botServiceUrl);
      expect(config.userServiceUrl).toBe('http://stored-user');
    });

    it('says which fields it filled, so an unexpected URL can be traced', async () => {
      const { botServiceUrl: _a, userServiceUrl: _b, ...incomplete } = stored;
      store.set('app_hl_config', incomplete);

      await service.loadConfig();

      expect(console.warn).toHaveBeenCalledTimes(1);
      const message = String(vi.mocked(console.warn).mock.calls[0][0]);
      expect(message).toContain('botServiceUrl');
      expect(message).toContain('userServiceUrl');
    });

    it('stays silent when nothing is missing', async () => {
      store.set('app_hl_config', stored);

      await service.loadConfig();

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('keeps a field this build does not know, so an older build does not amputate a newer one', async () => {
      store.set('app_hl_config', { ...stored, futureUrl: 'http://future' });

      const config = (await service.loadConfig()) as AppConfig & { futureUrl?: string };

      expect(config.futureUrl).toBe('http://future');
    });

    it.each([
      ['a number', 42],
      ['null', null],
      ['an object', { url: 'x' }],
    ])('refuses a URL that is %s, and keeps the live configuration', async (_label, bad) => {
      store.set('app_hl_config', { ...stored, botServiceUrl: bad });

      await expect(service.loadConfig()).rejects.toThrow(/botServiceUrl/);

      expect(service.getConfig()).toEqual(environment.defaultConfig);
    });

    it('refuses a stored value that is not an object at all', async () => {
      store.set('app_hl_config', 'http://just-a-string');

      await expect(service.loadConfig()).rejects.toThrow(/not an object/);

      expect(service.getConfig()).toEqual(environment.defaultConfig);
    });

    it('refuses an array', async () => {
      store.set('app_hl_config', [stored]);

      await expect(service.loadConfig()).rejects.toThrow(/array/);
    });

    it('accepts an empty string: an unconfigured production field is empty, not corrupt', async () => {
      store.set('app_hl_config', { ...stored, botServiceUrl: '' });

      expect((await service.loadConfig()).botServiceUrl).toBe('');
    });
  });

  describe('saveConfig', () => {
    it('writes under app_hl_config and publishes the same configuration', async () => {
      await service.saveConfig(stored);

      expect(store.get('app_hl_config')).toEqual(stored);
      expect(service.getConfig()).toEqual(stored);
    });

    // L'écriture d'abord : si elle échoue, l'app ne doit pas se mettre à parler
    // à des URL que le prochain démarrage ne retrouvera pas.
    it('leaves the live configuration untouched when the write fails', async () => {
      failWrites = true;

      await expect(service.saveConfig(stored)).rejects.toThrow('disk full');

      expect(service.getConfig()).toEqual(environment.defaultConfig);
    });
  });

  describe('updateConfig', () => {
    it('changes only the fields it is given', async () => {
      await service.saveConfig(stored);

      await service.updateConfig({ botServiceUrl: 'http://new-bot' });

      expect(service.getConfig()).toEqual({ ...stored, botServiceUrl: 'http://new-bot' });
      expect(store.get('app_hl_config')).toEqual({ ...stored, botServiceUrl: 'http://new-bot' });
    });
  });

  describe('the URL getters', () => {
    it('each read their own field and follow a change', async () => {
      await service.saveConfig(stored);

      expect(service.userServiceUrl).toBe('http://stored-user');
      expect(service.hyperliquidPublicUrl).toBe('http://stored-public');
      expect(service.hyperliquidGatewayUrl).toBe('http://stored-gateway');
      expect(service.botServiceUrl).toBe('http://stored-bot');

      await service.updateConfig({ botServiceUrl: 'http://moved-bot' });
      expect(service.botServiceUrl).toBe('http://moved-bot');
    });
  });
});
