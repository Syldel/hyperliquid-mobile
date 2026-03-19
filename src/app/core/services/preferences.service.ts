import { computed, inject, Injectable, signal } from '@angular/core';
import { StorageService } from '@storage/storage.service';

interface AppPreferences {
  locale: string;
}

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly storage = inject(StorageService);

  private readonly STORAGE_KEY = 'app_hl_preferences';

  private readonly _preferences = signal<AppPreferences>({ locale: 'fr-FR' });
  readonly preferences = this._preferences.asReadonly();
  readonly locale = computed(() => this._preferences().locale);

  async loadPreferences(): Promise<AppPreferences> {
    const storedPreferences = await this.storage.get<AppPreferences>(this.STORAGE_KEY);
    if (storedPreferences) {
      this._preferences.set(storedPreferences);
    }
    return this._preferences();
  }

  async savePreferences(preferences: AppPreferences): Promise<void> {
    await this.storage.set(this.STORAGE_KEY, preferences);
    this._preferences.set(preferences);
  }

  async updatePreferences(partial: Partial<AppPreferences>): Promise<void> {
    const currentPreferences = this._preferences() ?? (await this.loadPreferences());
    const updatedPreferences = { ...currentPreferences, ...partial };
    await this.savePreferences(updatedPreferences);
  }
}
