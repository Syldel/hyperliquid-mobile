/**
 * jsdom (l'environnement DOM simulé utilisé par Vitest) n'implémente pas
 * `window.matchMedia` — une lacune de jsdom, sans rapport avec le bug Ionic
 * traité par l'alias de vitest.config.ts. Nécessaire pour tout service/composant
 * qui la lit (ex: `ThemeService.prefersDarkQuery`).
 *
 * Renvoie toujours `matches: false` et n'émet jamais d'évènement `change` :
 * suffisant pour qu'un service comme `ThemeService` s'instancie et
 * s'initialise sans planter, pas pour tester un vrai changement de
 * préférence système (hors périmètre ici — à enrichir si un spec a
 * explicitement besoin de simuler `prefers-color-scheme`).
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
