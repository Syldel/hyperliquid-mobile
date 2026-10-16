import { inject, Injectable } from '@angular/core';
import { AppConfig } from '@models/app-config.interface';
import { StorageService } from '@storage/storage.service';
import { environment } from 'environments/environment';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly storage = inject(StorageService);
  private readonly STORAGE_KEY = 'app_hl_config';
  private readonly _config$ = new BehaviorSubject<AppConfig>({
    ...environment.defaultConfig,
  });

  get config$(): Observable<AppConfig> {
    return this._config$.asObservable();
  }

  /**
   * Applique la config stockée par-dessus le défaut du build — **champ par
   * champ**, et en le disant.
   *
   * Elle remplaçait le défaut en entier : un champ ajouté depuis à `AppConfig`
   * se lisait `undefined`, d'où des requêtes vers `undefined/auth/me`, sans
   * aucune erreur. Un champ **absent** reprend désormais le défaut du build, et
   * un `console.warn` le nomme ; la prochaine sauvegarde réécrit une config
   * complète. Un champ qui n'est pas une chaîne, ou une valeur qui n'est pas un
   * objet, est un stockage **corrompu** : on lève, et la config courante (le
   * défaut) reste en place — mieux qu'une URL devinée.
   *
   * Les champs inconnus de ce build sont conservés : une config écrite par une
   * version plus récente ne doit pas être amputée par celle-ci.
   */
  async loadConfig(): Promise<AppConfig> {
    const stored = await this.storage.get<unknown>(this.STORAGE_KEY);
    if (stored !== null && stored !== undefined) {
      this._config$.next(this.reconcileWithDefaults(stored));
    }
    return this._config$.value!;
  }

  private reconcileWithDefaults(stored: unknown): AppConfig {
    if (typeof stored !== 'object' || Array.isArray(stored)) {
      throw new Error(
        `Stored configuration "${this.STORAGE_KEY}" is not an object (${Array.isArray(stored) ? 'array' : typeof stored}); keeping the build default.`,
      );
    }

    const defaults = environment.defaultConfig;
    const record = stored as Record<string, unknown>;
    const filled: string[] = [];

    for (const key of Object.keys(defaults) as (keyof AppConfig)[]) {
      const value = record[key];
      if (value === undefined) {
        filled.push(key);
      } else if (typeof value !== 'string') {
        throw new Error(
          `Stored configuration "${this.STORAGE_KEY}": "${key}" is a ${value === null ? 'null' : typeof value}, not a URL string; keeping the build default.`,
        );
      }
    }

    if (filled.length > 0) {
      console.warn(
        `[ConfigService] Stored configuration lacks ${filled.join(', ')}; using the build default for ${filled.length > 1 ? 'them' : 'it'}.`,
      );
    }

    return { ...defaults, ...record } as AppConfig;
  }

  async saveConfig(config: AppConfig): Promise<void> {
    await this.storage.set(this.STORAGE_KEY, config);
    this._config$.next(config);
  }

  async updateConfig(partial: Partial<AppConfig>): Promise<void> {
    const currentConfig = this._config$.value ?? (await this.loadConfig());
    const updatedConfig = { ...currentConfig, ...partial };
    await this.saveConfig(updatedConfig);
  }

  getConfig(): AppConfig {
    const config = this._config$.value;
    if (!config) throw new Error('Config not loaded yet. Call loadConfig() first.');
    return config;
  }

  get userServiceUrl(): string {
    return this.getConfig().userServiceUrl;
  }

  get hyperliquidPublicUrl(): string {
    return this.getConfig().hyperliquidPublicUrl;
  }

  get hyperliquidGatewayUrl(): string {
    return this.getConfig().hyperliquidGatewayUrl;
  }

  get botServiceUrl(): string {
    return this.getConfig().botServiceUrl;
  }
}
