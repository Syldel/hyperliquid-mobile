import { Injectable, signal } from '@angular/core';
import { StorageService } from '@storage/storage.service';

export type Theme = 'light' | 'dark' | 'auto';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly THEME_STORAGE_KEY = 'app-theme-preference';

  private _isDarkMode = signal<boolean>(false);
  private _currentTheme = signal<Theme>('auto');

  isDarkMode = this._isDarkMode.asReadonly();
  currentTheme = this._currentTheme.asReadonly();

  private prefersDarkQuery!: MediaQueryList;

  constructor(private storage: StorageService) {
    this.prefersDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }

  /**
   * Initialise le thème au démarrage de l'app
   * À appeler dans app.component.ts
   */
  async initialize(): Promise<void> {
    const savedTheme = await this.storage.get<Theme>(this.THEME_STORAGE_KEY);

    if (savedTheme && savedTheme !== 'auto') {
      this._currentTheme.set(savedTheme);
      this.applyTheme(savedTheme === 'dark');
    } else {
      this._currentTheme.set('auto');
      this.initializeFromSystemPreference();
    }
  }

  /**
   * Initialise basé sur prefers-color-scheme
   */
  private initializeFromSystemPreference(): void {
    this.applyTheme(this.prefersDarkQuery.matches);

    this.prefersDarkQuery.addEventListener('change', (e) => {
      if (this._currentTheme() === 'auto') {
        this.applyTheme(e.matches);
      }
    });
  }

  /**
   * Change le thème manuellement (action utilisateur)
   */
  async setTheme(theme: Theme): Promise<void> {
    this._currentTheme.set(theme);

    await this.storage.set(this.THEME_STORAGE_KEY, theme);

    if (theme === 'auto') {
      this.applyTheme(this.prefersDarkQuery.matches);
    } else {
      this.applyTheme(theme === 'dark');
    }
  }

  /**
   * Toggle entre light et dark (pas auto)
   */
  async toggleTheme(isDark: boolean): Promise<void> {
    const newTheme: Theme = isDark ? 'dark' : 'light';
    await this.setTheme(newTheme);
  }

  /**
   * Applique physiquement le thème
   */
  private applyTheme(isDark: boolean): void {
    this._isDarkMode.set(isDark);

    const html = document.documentElement;

    html.classList.remove('dark-theme', 'light-theme');

    const theme = this._currentTheme();
    if (theme !== 'auto') {
      html.classList.add(`${theme}-theme`);
    }

    html.style.colorScheme = isDark ? 'dark' : 'light';
  }

  /**
   * Récupère le thème système actuel
   */
  getSystemPreference(): boolean {
    return this.prefersDarkQuery.matches;
  }
}
