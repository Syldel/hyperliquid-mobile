import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';

/**
 * Le plugin Preferences, tel que son implémentation web le fait : un
 * `localStorage` qui **convertit en chaîne** ce qu'on lui donne (`setItem`) et
 * rend `null` pour une clé absente. Copié de
 * `node_modules/@capacitor/preferences/dist/esm/web.js`, pas deviné.
 */
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: unknown }) => {
      store.set(key, String(value));
    },
    remove: async ({ key }: { key: string }) => {
      store.delete(key);
    },
    clear: async () => store.clear(),
  },
}));

/**
 * ============================================================================
 * Le format que tout le reste lit : **tout est écrit en JSON, chaînes
 * comprises**, et la lecture tente un JSON avant de rendre la chaîne telle
 * quelle — ce qui laisse lisibles les anciennes chaînes brutes.
 *
 * Jusqu'au 2026-10-15 une chaîne était écrite brute, et `set('k', '123')` puis
 * `get('k')` rendait le nombre `123` ; `set('k', undefined)` écrivait la chaîne
 * `"undefined"`. Les deux sont corrigés ici, et chacun a son test.
 * ============================================================================
 */
describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    store.clear();
    service = TestBed.inject(StorageService);
  });

  describe('what is written', () => {
    it('writes a string JSON-encoded, so that what looks like JSON stays a string', async () => {
      await service.set('theme', 'dark');

      expect(store.get('theme')).toBe('"dark"');
    });

    it('writes an object as JSON', async () => {
      await service.set('config', { a: 1, b: ['x'] });

      expect(store.get('config')).toBe('{"a":1,"b":["x"]}');
    });

    it('writes null as the JSON null, so that clearing a value is a write and not an absence', async () => {
      await service.set('currentAddress', null);

      expect(store.get('currentAddress')).toBe('null');
    });
  });

  describe('a value with no JSON form', () => {
    // `JSON.stringify(undefined)` vaut `undefined`, que le plugin web convertit
    // en la chaîne "undefined" : une écriture réussie d'une donnée qui n'existe pas.
    it('refuses undefined instead of writing the text "undefined"', async () => {
      await expect(service.set('k', undefined)).rejects.toThrow(TypeError);

      expect(store.has('k')).toBe(false);
    });

    it('refuses a function', async () => {
      await expect(service.set('k', () => 1)).rejects.toThrow(/no JSON form/);
    });

    it('names the key in the refusal, so the call site can be found', async () => {
      await expect(service.set('userWallets', undefined)).rejects.toThrow(/userWallets/);
    });
  });

  describe('what is read back', () => {
    it.each([
      ['an object', { a: 1, nested: { b: [1, 2] } }],
      ['an array', [1, 'two', { three: 3 }]],
      ['a number', 42],
      ['a boolean', false],
      ['a null', null],
    ])('returns %s as it was written', async (_label, value) => {
      await service.set('k', value);

      expect(await service.get('k')).toEqual(value);
    });

    // Des données écrites avant que le format soit celui-ci (ou par une autre
    // version) ne doivent pas faire lever la lecture.
    it('returns a plain string that is not JSON, rather than throwing', async () => {
      store.set('theme', 'dark');

      expect(await service.get('theme')).toBe('dark');
    });

    it('returns a wallet address as a string, written the old way or the new', async () => {
      store.set('legacy', '0xabc123');
      await service.set('current', '0xabc123');

      expect(await service.get('legacy')).toBe('0xabc123');
      expect(await service.get('current')).toBe('0xabc123');
    });

    it('returns null for a key that was never written', async () => {
      expect(await service.get('absent')).toBeNull();
    });

    // Une chaîne qui ressemble à du JSON revenait transformée : `'123'` rendait
    // le nombre 123, `'true'` le booléen.
    it.each(['123', 'true', 'null', '{"a":1}', '[1]', '""'])(
      'returns the string %s as a string, not as what it looks like',
      async (text) => {
        await service.set('k', text);

        expect(await service.get('k')).toBe(text);
      },
    );

    it('round-trips the empty string as an empty string', async () => {
      await service.set('k', '');

      expect(await service.get('k')).toBe('');
    });

    // Ce que l'app avait écrit avant le changement de format : `''` brut est lu
    // comme une absence, comme avant.
    it('still reads a legacy empty value as an absence', async () => {
      store.set('k', '');

      expect(await service.get('k')).toBeNull();
    });
  });

  describe('remove and clear', () => {
    it('forgets one key and leaves the others', async () => {
      await service.set('a', 'x');
      await service.set('b', 'y');

      await service.remove('a');

      expect(await service.get('a')).toBeNull();
      expect(await service.get('b')).toBe('y');
    });

    it('forgets everything on clear', async () => {
      await service.set('a', 'x');
      await service.set('b', 'y');

      await service.clear();

      expect(await service.get('a')).toBeNull();
      expect(await service.get('b')).toBeNull();
    });

    it('does not fail on removing a key that is not there', async () => {
      await expect(service.remove('absent')).resolves.toBeUndefined();
    });
  });
});
