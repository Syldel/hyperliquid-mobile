import { inject, Injectable, InjectionToken } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

/** La partie du plugin Preferences que le service utilise. */
export type PreferencesApi = Pick<typeof Preferences, 'get' | 'set' | 'remove' | 'clear'>;

/**
 * Le plugin est injecté plutôt qu'importé en dur : un spec fournit un faux par
 * `providers`, et le service et le spec manipulent forcément le même objet,
 * quel que soit l'ordre de chargement des modules ou l'état du cache du builder.
 */
export const PREFERENCES = new InjectionToken<PreferencesApi>('PREFERENCES', {
  providedIn: 'root',
  // Objet simple, et non le plugin : celui-ci est un Proxy qui répond à toute
  // propriété, `ngOnDestroy` compris. Angular l'appellerait à la destruction de
  // l'injecteur, et le plugin web rejetterait avec UNIMPLEMENTED.
  factory: () => ({
    get: (options) => Preferences.get(options),
    set: (options) => Preferences.set(options),
    remove: (options) => Preferences.remove(options),
    clear: () => Preferences.clear(),
  }),
});

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly prefs = inject(PREFERENCES);

  /**
   * Stocke une valeur, **toujours encodée en JSON** — chaînes comprises.
   *
   * Une chaîne était écrite telle quelle, et `get` tentait un JSON avant de la
   * rendre : `set('k', '123')` puis `get('k')` rendait le **nombre** `123`, et
   * `'true'` rendait `true`. Aucun appelant n'en a souffert (adresses `0x…`,
   * thème), ce qui ne dit rien du prochain. Encodée, `'123'` s'écrit `"123"` et
   * revient chaîne.
   *
   * Pas de migration : la lecture reste tolérante, une ancienne chaîne brute qui
   * n'est pas du JSON (`dark`, `0xabc…`) revient telle quelle. Seule une ancienne
   * chaîne brute **qui ressemblait à du JSON** reste mal lue, et aucune n'existe.
   *
   * @throws si la valeur n'a pas d'encodage JSON (`undefined`, une fonction) :
   * `JSON.stringify` rend alors `undefined`, que le plugin convertit en la
   * chaîne `"undefined"` — une écriture réussie d'une donnée qui n'existe pas.
   * Pour effacer, `null` ou `remove`.
   */
  async set<T = unknown>(key: string, value: T): Promise<void> {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError(
        `StorageService.set("${key}"): refusing to store a value with no JSON form (${typeof value}). Use null to clear, or remove().`,
      );
    }
    await this.prefs.set({ key, value: encoded });
  }

  /** Récupère une valeur, si c'était un objet, on parse automatiquement */
  async get<T = unknown>(key: string): Promise<T | null> {
    const { value } = await this.prefs.get({ key });
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async remove(key: string): Promise<void> {
    await this.prefs.remove({ key });
  }

  async clear(): Promise<void> {
    await this.prefs.clear();
  }
}
