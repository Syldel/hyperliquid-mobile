import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

@Injectable({ providedIn: 'root' })
export class StorageService {
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
  async set<T = any>(key: string, value: T): Promise<void> {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError(
        `StorageService.set("${key}"): refusing to store a value with no JSON form (${typeof value}). Use null to clear, or remove().`,
      );
    }
    await Preferences.set({ key, value: encoded });
  }

  /** Récupère une valeur, si c'était un objet, on parse automatiquement */
  async get<T = any>(key: string): Promise<T | null> {
    const { value } = await Preferences.get({ key });
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  }

  async clear(): Promise<void> {
    await Preferences.clear();
  }
}
