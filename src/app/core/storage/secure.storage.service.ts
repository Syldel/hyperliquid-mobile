import { Injectable } from '@angular/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

@Injectable({ providedIn: 'root' })
export class SecureStorageService {
  constructor() {}

  private _stringifyContent(data: any): string {
    if (data === null || data === undefined) {
      return '';
    }

    if (typeof data === 'string') {
      return data;
    }

    try {
      return JSON.stringify(data);
    } catch (e) {
      return String(data);
    }
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

  async get<T = any>(key: string): Promise<T | null> {
    try {
      const result = await SecureStoragePlugin.get({ key });
      const rawValue = result?.value;

      if (!rawValue) {
        return null;
      }

      try {
        return JSON.parse(rawValue) as T;
      } catch {
        return rawValue as unknown as T;
      }
    } catch (e) {
      return null;
    }
  }

  async set(key: string, data: any): Promise<boolean> {
    try {
      const value = this._stringifyContent(data);
      const result = await SecureStoragePlugin.set({ key, value });
      return result.value;
    } catch (e) {
      console.error(`set(${key}) error:`, e);
      return false;
    }
  }

  async isExist(key: string): Promise<boolean> {
    try {
      await SecureStoragePlugin.get({ key });
      return true;
    } catch (err) {
      return false;
    }
  }
}
