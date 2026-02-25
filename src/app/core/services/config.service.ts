import { Injectable } from '@angular/core';
import { AppConfig } from '@models/app-config.interface';
import { StorageService } from '@storage/storage.service';
import { environment } from 'environments/environment';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly STORAGE_KEY = 'app_hl_config';
  private readonly _config$ = new BehaviorSubject<AppConfig>({
    userServiceUrl: '',
    hyperliquidPublicUrl: environment.hyperliquidPublicUrl,
    hyperliquidGatewayUrl: '',
  });

  constructor(private readonly storage: StorageService) {}

  get config$(): Observable<AppConfig> {
    return this._config$.asObservable();
  }

  async loadConfig(): Promise<AppConfig> {
    const storedConfig = await this.storage.get<AppConfig>(this.STORAGE_KEY);
    if (storedConfig) {
      this._config$.next(storedConfig);
    }
    return this._config$.value!;
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
}
