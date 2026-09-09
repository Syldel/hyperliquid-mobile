import { STRATEGY_COLORS, strategyColor } from './strategy-color.util';

describe('strategyColor', () => {
  // La stabilité est le point : une couleur qui changerait d'un rendu à
  // l'autre déferait le lien entre une pastille de chip et ses marqueurs.
  it('always gives the same colour to the same id', () => {
    expect(strategyColor('st_abc')).toBe(strategyColor('st_abc'));
  });

  it('always picks from the palette', () => {
    const ids = ['st_1', 'st_2', 'st_abc', 'st_' + 'x'.repeat(50), 'a'];
    for (const id of ids) {
      expect(STRATEGY_COLORS).toContain(strategyColor(id));
    }
  });

  it('spreads a handful of ids over several colours rather than collapsing them', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `st_${index}`);
    const distinct = new Set(ids.map(strategyColor));

    expect(distinct.size).toBeGreaterThan(1);
  });

  it('handles an empty id without throwing', () => {
    expect(STRATEGY_COLORS).toContain(strategyColor(''));
  });

  // Le rouge et le vert appartiennent aux bougies et aux côtés LONG/SHORT :
  // les réutiliser ferait lire une identité comme une direction.
  it('keeps plain red and green out of the palette', () => {
    expect(STRATEGY_COLORS).not.toContain('#2dd36f');
    expect(STRATEGY_COLORS).not.toContain('#eb445a');
  });
});
