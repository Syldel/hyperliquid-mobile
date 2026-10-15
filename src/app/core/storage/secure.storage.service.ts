import { Injectable } from '@angular/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/**
 * Le trousseau n'a pas pu être lu — distinct d'une clé qui n'existe pas.
 *
 * `get` rendait `null` pour les deux : un trousseau verrouillé ou corrompu se
 * lisait « je ne suis pas connecté », sans trace de pourquoi, et la connexion
 * suivante réécrivait la table des jetons à partir d'un état vide, effaçant ceux
 * des autres wallets une fois le trousseau revenu.
 */
export class SecureStorageReadError extends Error {
  constructor(
    readonly key: string,
    cause: unknown,
  ) {
    super(`Secure storage could not be read for "${key}": ${String(cause)}`);
    this.name = 'SecureStorageReadError';
    this.cause = cause;
  }
}

@Injectable({ providedIn: 'root' })
export class SecureStorageService {
  constructor() {}

  /**
   * Même contrat que `StorageService.set` : tout est encodé en JSON, chaînes
   * comprises, et une valeur sans forme JSON est **refusée**.
   *
   * `null` s'écrit `null` — il s'écrivait `''`, que `get` lisait comme une
   * absence : le même résultat par un chemin qui ne disait pas ce qu'il faisait.
   * Les anciennes valeurs (`''`, jetons bruts) restent lisibles.
   */
  private _stringifyContent(key: string, data: unknown): string {
    const encoded = JSON.stringify(data);
    if (encoded === undefined) {
      throw new TypeError(
        `SecureStorageService.set("${key}"): refusing to store a value with no JSON form (${typeof data}). Use null to clear, or remove().`,
      );
    }
    return encoded;
  }

  async clear(): Promise<boolean> {
    try {
      const result = await SecureStoragePlugin.clear();
      return result.value;
    } catch (e) {
      console.error('clear() error:', e);
      return false;
    }
  }

  async remove(key: string): Promise<boolean> {
    try {
      const result = await SecureStoragePlugin.remove({ key });
      return result.value;
    } catch (e) {
      console.error(`remove(${key}) error:`, e);
      return false;
    }
  }

  /**
   * @returns `null` si la clé **n'existe pas**.
   * @throws {SecureStorageReadError} si le trousseau n'a pas pu être lu.
   *
   * L'existence se demande à `keys()` plutôt que de se déduire du message de
   * rejet de `get` (« Item with given key does not exist ») : un message se
   * reformule d'une version du plugin à l'autre, et un message inconnu serait
   * alors pris pour une absence — le défaut qu'on corrige, en silence.
   */
  async get<T = any>(key: string): Promise<T | null> {
    let rawValue: string | undefined;
    try {
      const { value: keys } = await SecureStoragePlugin.keys();
      if (!keys.includes(key)) return null;

      rawValue = (await SecureStoragePlugin.get({ key }))?.value;
    } catch (e) {
      console.error(`get(${key}) error:`, e);
      throw new SecureStorageReadError(key, e);
    }

    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue) as T;
    } catch {
      return rawValue as unknown as T;
    }
  }

  async set(key: string, data: any): Promise<boolean> {
    // Hors du `try` : un `undefined` est une erreur de programmation, pas une
    // panne du trousseau, et ne doit pas se faire passer pour un `false`.
    const value = this._stringifyContent(key, data);
    try {
      const result = await SecureStoragePlugin.set({ key, value });
      return result.value;
    } catch (e) {
      console.error(`set(${key}) error:`, e);
      return false;
    }
  }

  /** `false` pour une clé absente. Lève {@link SecureStorageReadError} si le trousseau est illisible. */
  async isExist(key: string): Promise<boolean> {
    try {
      const { value: keys } = await SecureStoragePlugin.keys();
      return keys.includes(key);
    } catch (e) {
      throw new SecureStorageReadError(key, e);
    }
  }
}
