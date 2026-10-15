import { TestBed } from '@angular/core/testing';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { SecureStorageReadError, SecureStorageService } from './secure.storage.service';

/**
 * Le plugin, comme son implémentation web le fait — copié de
 * `node_modules/capacitor-secure-storage-plugin/dist/esm/web.js` : `get` et
 * `remove` **rejettent** quand la clé est absente, `set` et `clear` rendent
 * `{ value: true }`, `keys` rend `{ value: string[] }`.
 */
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: ({ key }: { key: string }) =>
      store.has(key)
        ? Promise.resolve({ value: store.get(key) })
        : Promise.reject('Item with given key does not exist'),
    set: ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
      return Promise.resolve({ value: true });
    },
    remove: ({ key }: { key: string }) => {
      if (!store.has(key)) return Promise.reject('Item with given key does not exist');
      store.delete(key);
      return Promise.resolve({ value: true });
    },
    clear: () => {
      store.clear();
      return Promise.resolve({ value: true });
    },
    keys: () => Promise.resolve({ value: [...store.keys()] }),
  },
}));

/**
 * ============================================================================
 * Le coffre des jetons de wallet.
 *
 * Deux situations que `get` confondait en un `null` — la clé n'existe pas, et
 * le trousseau a échoué — sont distinguées depuis le 2026-10-15 : la première
 * rend `null`, la seconde **lève** `SecureStorageReadError`. Pour des jetons,
 * le second cas se lisait « je ne suis pas connecté », et la connexion suivante
 * effaçait ceux des autres wallets (voir `AuthService.assertSessionRestored`).
 * ============================================================================
 */
describe('SecureStorageService', () => {
  let service: SecureStorageService;

  beforeEach(() => {
    store.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service = TestBed.inject(SecureStorageService);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('what is written', () => {
    it('writes a string JSON-encoded, so that what looks like JSON stays a string', async () => {
      await service.set('jwt', 'eyJhbGciOi');

      expect(store.get('jwt')).toBe('"eyJhbGciOi"');
    });

    it('writes an object as JSON', async () => {
      await service.set('tokens', { '0xabc': 'jwt-a' });

      expect(store.get('tokens')).toBe('{"0xabc":"jwt-a"}');
    });

    it('writes null as the JSON null', async () => {
      await service.set('tokens', null);

      expect(store.get('tokens')).toBe('null');
    });

    it('reports success as true', async () => {
      expect(await service.set('k', 'v')).toBe(true);
    });

    // Une erreur de programmation ne doit pas se faire passer pour une panne du
    // trousseau (`false`) : elle lève.
    it('refuses a value with no JSON form, naming the key, rather than answering false', async () => {
      await expect(service.set('tokens', undefined)).rejects.toThrow(/tokens.*no JSON form/);

      expect(store.has('tokens')).toBe(false);
    });
  });

  describe('what is read back', () => {
    it('returns an object as it was written', async () => {
      await service.set('tokens', { '0xabc': 'jwt-a', '0xdef': 'jwt-b' });

      expect(await service.get('tokens')).toEqual({ '0xabc': 'jwt-a', '0xdef': 'jwt-b' });
    });

    it('returns a token as a string, written the old way or the new', async () => {
      store.set('legacy', 'aaa.bbb.ccc');
      await service.set('current', 'aaa.bbb.ccc');

      expect(await service.get('legacy')).toBe('aaa.bbb.ccc');
      expect(await service.get('current')).toBe('aaa.bbb.ccc');
    });

    it('returns a string that looks like JSON as a string', async () => {
      await service.set('pin', '123456');

      expect(await service.get('pin')).toBe('123456');
    });

    it('reads a value set to null as an absence', async () => {
      await service.set('tokens', null);

      expect(await service.get('tokens')).toBeNull();
    });

    // `''` est ce que l'ancienne version écrivait pour `null`.
    it('still reads a legacy empty value as an absence', async () => {
      store.set('tokens', '');

      expect(await service.get('tokens')).toBeNull();
    });
  });

  describe('a key that does not exist', () => {
    it('is null, and is not an error', async () => {
      expect(await service.get('absent')).toBeNull();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('is reported false by isExist', async () => {
      expect(await service.isExist('absent')).toBe(false);
    });
  });

  describe('when the keychain cannot be read', () => {
    it('throws a named error instead of answering "absent"', async () => {
      await service.set('tokens', { a: 1 });
      vi.spyOn(SecureStoragePlugin, 'get').mockRejectedValueOnce(new Error('keychain locked'));

      const failure = await service.get('tokens').catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(SecureStorageReadError);
      expect((failure as SecureStorageReadError).key).toBe('tokens');
      expect((failure as Error).message).toContain('keychain locked');
    });

    // L'existence ne se déduit pas du texte d'un rejet : un message reformulé
    // par une version du plugin serait pris pour une absence.
    it('does not take an unfamiliar rejection message for an absence', async () => {
      await service.set('tokens', { a: 1 });
      vi.spyOn(SecureStoragePlugin, 'get').mockRejectedValueOnce(
        'Item with given key does not exist (reworded)',
      );

      await expect(service.get('tokens')).rejects.toBeInstanceOf(SecureStorageReadError);
    });

    it('throws when the list of keys itself cannot be read', async () => {
      vi.spyOn(SecureStoragePlugin, 'keys').mockRejectedValueOnce(new Error('denied'));

      await expect(service.get('tokens')).rejects.toBeInstanceOf(SecureStorageReadError);
    });

    it('says so in the console as well', async () => {
      vi.spyOn(SecureStoragePlugin, 'keys').mockRejectedValueOnce(new Error('denied'));

      await service.get('tokens').catch(() => undefined);

      expect(console.error).toHaveBeenCalled();
    });

    it('makes isExist throw rather than answer false', async () => {
      vi.spyOn(SecureStoragePlugin, 'keys').mockRejectedValueOnce(new Error('denied'));

      await expect(service.isExist('tokens')).rejects.toBeInstanceOf(SecureStorageReadError);
    });
  });

  describe('when the keychain refuses a write', () => {
    it('reports a failed write as false, and says so in the console', async () => {
      vi.spyOn(SecureStoragePlugin, 'set').mockRejectedValueOnce(new Error('keychain locked'));

      expect(await service.set('tokens', { a: 1 })).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });

    it('does not report a refused write as a success', async () => {
      vi.spyOn(SecureStoragePlugin, 'set').mockResolvedValueOnce({ value: false });

      expect(await service.set('tokens', { a: 1 })).toBe(false);
    });
  });

  describe('remove, clear and isExist', () => {
    it('removes a key and reports it', async () => {
      await service.set('k', 'v');

      expect(await service.remove('k')).toBe(true);
      expect(await service.get('k')).toBeNull();
    });

    it('reports false for removing a key that is not there, the plugin rejecting it', async () => {
      expect(await service.remove('absent')).toBe(false);
    });

    it('clears everything', async () => {
      await service.set('a', '1');
      await service.set('b', '2');

      expect(await service.clear()).toBe(true);
      expect(await service.isExist('a')).toBe(false);
      expect(await service.isExist('b')).toBe(false);
    });

    it('says whether a key exists', async () => {
      await service.set('k', 'v');

      expect(await service.isExist('k')).toBe(true);
      expect(await service.isExist('absent')).toBe(false);
    });
  });
});
