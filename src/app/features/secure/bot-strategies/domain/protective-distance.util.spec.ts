import type { PriceDistance } from '@syldel/trading-shared-types';
import {
  MISSING_DISTANCE_LABEL,
  distanceUnitSuffix,
  protectiveDistanceLabel,
} from './protective-distance.util';

/**
 * La règle que ce fichier garde : **ne jamais afficher une unité que la donnée
 * ne porte pas.**
 *
 * La version précédente était un ternaire de gabarit, `unit === 'PERCENT' ? '%'
 * : '×ATR'`. Il rendait `×ATR` pour une distance absente comme pour une unité
 * inconnue — sur l'écran qui configure de vrais ordres protecteurs.
 */
describe('protectiveDistanceLabel', () => {
  it('glues the symbol of a known unit to its number', () => {
    expect(protectiveDistanceLabel({ unit: 'PERCENT', value: 10 })).toBe('10%');
    expect(protectiveDistanceLabel({ unit: 'ATR', value: 1.5 })).toBe('1.5×ATR');
  });

  it('accepts a PriceDistance of the shared types as it stands', () => {
    // Le type stocké est plus large, pas différent : si l'assignation cessait
    // de passer, chaque appelant devrait caster — et c'est le cast qui a fait
    // naître le défaut d'origine.
    const distance: PriceDistance = { unit: 'ATR', value: 2 };
    expect(protectiveDistanceLabel(distance)).toBe('2×ATR');
  });

  it('says a distance is missing instead of inventing an ATR multiple', () => {
    /**
     * Le cas réel : `atrMultiplier` a été remplacé par `distance`, donc une
     * entrée écrite avant la bascule n'en porte aucune. Le badge affichait
     * `×ATR` tout seul, sans nombre.
     */
    expect(protectiveDistanceLabel(undefined)).toBe(MISSING_DISTANCE_LABEL);
    expect(protectiveDistanceLabel({})).toBe(MISSING_DISTANCE_LABEL);
  });

  it('treats a value that cannot be multiplied as an absence', () => {
    // Un `ion-input type="number"` vidé rend une chaîne vide, et un formulaire
    // mal rempli a déjà produit `value: undefined` (les types partagés le
    // refusent nommément). Le bot ne peut multiplier ni l'un ni l'autre.
    expect(protectiveDistanceLabel({ unit: 'ATR', value: undefined })).toBe(MISSING_DISTANCE_LABEL);
    expect(protectiveDistanceLabel({ unit: 'ATR', value: NaN })).toBe(MISSING_DISTANCE_LABEL);
    expect(protectiveDistanceLabel({ unit: 'ATR', value: Infinity })).toBe(MISSING_DISTANCE_LABEL);
    expect(protectiveDistanceLabel({ unit: 'PERCENT', value: '10' as unknown as number })).toBe(
      MISSING_DISTANCE_LABEL,
    );
  });

  it('shows the stored code of a unit this build does not know', () => {
    /**
     * Les unités sont servies par `/exchanges/meta` : un bot plus récent peut
     * en faire enregistrer une que ce paquet ignore. La montrer telle quelle
     * est le choix que fait déjà `exitBehaviorLabels()[x] || x`.
     */
    expect(protectiveDistanceLabel({ unit: 'TICKS', value: 3 })).toBe('3 TICKS');
  });

  it('never leaves a number without the unit that qualifies it', () => {
    // L'invariant qui résume les deux défauts : soit le nombre et son unité,
    // soit le constat d'absence — jamais l'un sans l'autre.
    const cases = [
      undefined,
      {},
      { unit: 'ATR' },
      { value: 1.5 },
      { unit: 'ATR', value: 1.5 },
      { unit: 'PERCENT', value: 10 },
      { unit: 'TICKS', value: 3 },
    ];

    for (const distance of cases) {
      const label = protectiveDistanceLabel(distance);
      const hasNumber = /\d/.test(label);
      expect(hasNumber ? label.replace(/^[\d.]+\s?/, '') : MISSING_DISTANCE_LABEL).not.toBe('');
      if (!hasNumber) expect(label).toBe(MISSING_DISTANCE_LABEL);
    }
  });

  it('keeps a zero distance visible, the bot being the one to refuse it', () => {
    // Zéro est une valeur multipliable, donc affichable ; c'est la validation
    // partagée qui la refuse (« a distance never carries a sign »), pas le
    // badge. Un `!value` l'aurait fait passer pour une absence.
    expect(protectiveDistanceLabel({ unit: 'PERCENT', value: 0 })).toBe('0%');
  });
});

describe('distanceUnitSuffix', () => {
  it('gives the symbol of each unit this build knows', () => {
    expect(distanceUnitSuffix('ATR')).toBe('×ATR');
    expect(distanceUnitSuffix('PERCENT')).toBe('%');
  });

  it('echoes an unknown code and stays empty on an absent one', () => {
    expect(distanceUnitSuffix('TICKS')).toBe('TICKS');
    expect(distanceUnitSuffix(undefined)).toBe('');
    expect(distanceUnitSuffix('')).toBe('');
  });
});
