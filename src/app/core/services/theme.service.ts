import { inject, Injectable, signal } from '@angular/core';
import { StorageService } from '@storage/storage.service';

export type Theme = 'light' | 'dark' | 'auto';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly storage = inject(StorageService);
  private readonly THEME_STORAGE_KEY = 'app-theme-preference';

  private _isDarkMode = signal<boolean>(false);
  private _currentTheme = signal<Theme>('auto');

  isDarkMode = this._isDarkMode.asReadonly();
  currentTheme = this._currentTheme.asReadonly();

  private readonly prefersDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  /** Vrai une fois le thème sauvegardé lu : avant, un changement système n'est pas le nôtre à traiter. */
  private initialized = false;

  /**
   * L'écouteur de préférence système est posé **une seule fois, ici**, et c'est lui qui
   * décide s'il doit agir.
   *
   * Il était posé par `initialize()`, et seulement sur le chemin `auto` : démarrer sur un
   * thème choisi (`dark`) puis repasser à `auto` ne posait donc jamais d'écouteur, et
   * l'écran ne suivait plus le système avant le prochain démarrage ; deux appels à
   * `initialize()` en posaient deux. Corrigé le 2026-10-16 (voir le spec).
   */
  constructor() {
    this.prefersDarkQuery.addEventListener('change', (event) => {
      if (this.initialized && this._currentTheme() === 'auto') {
        this.applyTheme(event.matches);
      }
    });
  }

  /**
   * Initialise le thème au démarrage de l'app
   * À appeler dans app.component.ts
   */
  async initialize(): Promise<void> {
    const savedTheme = await this.storage.get<Theme>(this.THEME_STORAGE_KEY);
    this.initialized = true;

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
