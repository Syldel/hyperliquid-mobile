import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

@Injectable({ providedIn: 'root' })
export class StorageService {
  /** Stocke une valeur string ou un objet */
  async set<T = any>(key: string, value: T): Promise<void> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await Preferences.set({ key, value: stringValue });
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
