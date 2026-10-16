import { TestBed } from '@angular/core/testing';
import { StorageService } from '@storage/storage.service';
import { ThemeService } from './theme.service';

/**
 * Le thème : ce que l'utilisateur a choisi, ce que le système préfère, et ce que
 * l'écran applique.
 *
 * Ce spec existe parce que `ThemeService` allait changer de forme (injection par
 * constructeur → `inject()`), et que `docs/angular.md` ne convertit pas du code
 * sans test : il a été écrit sur la version à constructeur, puis rejoué à
 * l'identique après.
 *
 * ⚠️ Deux défauts relevés en l'écrivant, **non figés** ici (un test qui les
 * épinglerait fixerait le défaut avec) :
 *
 * - quand l'app démarre sur un thème **choisi** (`dark`) puis que l'utilisateur
 *   repasse à `auto`, aucun écouteur de préférence système n'est posé : l'écran
 *   ne suit plus le système avant le prochain démarrage ;
 * - `initialize()` pose un nouvel écouteur à chaque appel : deux appels, deux
 *   écouteurs.
 */

/** Une `MediaQueryList` pilotable : `matches` se change, `change` s'émet à la main. */
class FakeMediaQuery {
  matches = false;
  readonly listeners: ((event: { matches: boolean }) => void)[] = [];

  addEventListener(_type: string, listener: (event: { matches: boolean }) => void): void {
    this.listeners.push(listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((listener) => listener({ matches }));
  }
}

describe('ThemeService', () => {
  let service: ThemeService;
  let query: FakeMediaQuery;
  let store: Map<string, unknown>;
  const html = document.documentElement;

  /** Toute classe `*-theme` posée sur `<html>`, quel que soit son nom. */
  const themeClasses = () => [...html.classList].filter((name) => name.endsWith('-theme'));

  const create = () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: StorageService,
          useValue: {
            get: async (key: string) => (store.has(key) ? store.get(key) : null),
            set: async (key: string, value: unknown) => {
              store.set(key, value);
            },
          },
        },
      ],
    });
    service = TestBed.inject(ThemeService);
  };

  beforeEach(() => {
    store = new Map();
    query = new FakeMediaQuery();
    vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
    html.classList.remove('dark-theme', 'light-theme', 'auto-theme');
    html.style.colorScheme = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    html.classList.remove('dark-theme', 'light-theme', 'auto-theme');
    html.style.colorScheme = '';
  });

  it('asks for the system colour scheme preference', () => {
    create();

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  describe('initialize', () => {
    it('follows the system when nothing was saved: dark system, dark screen, and no forced class', async () => {
      query.matches = true;
      create();

      await service.initialize();

      expect(service.currentTheme()).toBe('auto');
      expect(service.isDarkMode()).toBe(true);
      expect(html.style.colorScheme).toBe('dark');
      // `auto` ne force aucune classe : c'est la feuille de style qui suit le système.
      expect(themeClasses()).toEqual([]);
    });

    // Système SOMBRE exprès : avec un système clair, « suivre le système » et
    // « appliquer un thème forcé » donnent le même résultat, et le test ne
    // distinguerait rien.
    it('treats a saved "auto" like nothing saved: it follows a dark system', async () => {
      store.set('app-theme-preference', 'auto');
      query.matches = true;
      create();

      await service.initialize();

      expect(service.currentTheme()).toBe('auto');
      expect(service.isDarkMode()).toBe(true);
      expect(html.style.colorScheme).toBe('dark');
    });

    it('follows later system changes after a saved "auto", as it does with nothing saved', async () => {
      store.set('app-theme-preference', 'auto');
      create();
      await service.initialize();

      query.emit(true);

      expect(service.isDarkMode()).toBe(true);
    });

    it('applies a saved choice over the system preference', async () => {
      store.set('app-theme-preference', 'dark');
      query.matches = false;
      create();

      await service.initialize();

      expect(service.currentTheme()).toBe('dark');
      expect(service.isDarkMode()).toBe(true);
      expect(html.classList.contains('dark-theme')).toBe(true);
      expect(html.style.colorScheme).toBe('dark');
    });

    it('does not follow system changes once a theme was chosen', async () => {
      store.set('app-theme-preference', 'light');
      create();
      await service.initialize();

      query.emit(true);

      expect(service.isDarkMode()).toBe(false);
      expect(html.classList.contains('light-theme')).toBe(true);
    });
  });

  describe('a manual choice made after starting in auto', () => {
    // C'est le seul chemin où l'écouteur existe ET où un thème forcé est actif :
    // le garde `currentTheme === 'auto'` ne s'exerce que là.
    it('is not overridden by a later change of the system preference', async () => {
      create();
      await service.initialize();
      await service.setTheme('light');

      query.emit(true);

      expect(service.currentTheme()).toBe('light');
      expect(service.isDarkMode()).toBe(false);
      expect(html.classList.contains('light-theme')).toBe(true);
    });
  });

  describe('in auto mode', () => {
    it('follows a change of the system preference', async () => {
      create();
      await service.initialize();
      expect(service.isDarkMode()).toBe(false);

      query.emit(true);

      expect(service.isDarkMode()).toBe(true);
      expect(html.style.colorScheme).toBe('dark');
    });
  });

  describe('setTheme', () => {
    it('applies the choice and saves it under its own key', async () => {
      create();

      await service.setTheme('dark');

      expect(service.currentTheme()).toBe('dark');
      expect(service.isDarkMode()).toBe(true);
      expect(html.classList.contains('dark-theme')).toBe(true);
      expect(store.get('app-theme-preference')).toBe('dark');
    });

    it('swaps the class instead of stacking them', async () => {
      create();
      await service.setTheme('dark');

      await service.setTheme('light');

      expect(html.classList.contains('light-theme')).toBe(true);
      expect(html.classList.contains('dark-theme')).toBe(false);
      expect(html.style.colorScheme).toBe('light');
    });

    it('goes back to the system preference on "auto", saves it, and forces no class', async () => {
      query.matches = true;
      create();
      await service.setTheme('light');

      await service.setTheme('auto');

      expect(store.get('app-theme-preference')).toBe('auto');
      expect(service.isDarkMode()).toBe(true);
      expect(themeClasses()).toEqual([]);
    });
  });

  describe('toggleTheme', () => {
    it('chooses dark or light explicitly, never auto', async () => {
      create();

      await service.toggleTheme(true);
      expect(service.currentTheme()).toBe('dark');

      await service.toggleTheme(false);
      expect(service.currentTheme()).toBe('light');
    });
  });

  it('reports the current system preference', () => {
    query.matches = true;
    create();

    expect(service.getSystemPreference()).toBe(true);

    query.matches = false;
    expect(service.getSystemPreference()).toBe(false);
  });
});
