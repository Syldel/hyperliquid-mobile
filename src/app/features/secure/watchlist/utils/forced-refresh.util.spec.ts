import { FORCED_REFRESH_COOLDOWN_MS, mayForceRefresh } from './forced-refresh.util';

describe('mayForceRefresh', () => {
  const t0 = 1_800_000_000_000;

  it('lets the first forced refresh through', () => {
    expect(mayForceRefresh(t0, null, false)).toBe(true);
  });

  // Dans le délai, le cache sert des données qui ont moins de 10 s : celles du rafraîchissement précédent.
  it('holds a second one back within the cooldown', () => {
    expect(mayForceRefresh(t0 + FORCED_REFRESH_COOLDOWN_MS - 1, t0, false)).toBe(false);
  });

  it('lets it through once the cooldown has passed', () => {
    expect(mayForceRefresh(t0 + FORCED_REFRESH_COOLDOWN_MS, t0, false)).toBe(true);
  });

  // Un échec n'a rien rangé à resservir : retenir la nouvelle tentative laisserait l'écran en panne.
  it('never holds back a retry after a failure', () => {
    expect(mayForceRefresh(t0 + 1, t0, true)).toBe(true);
  });
});
