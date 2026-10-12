import { formatDecimalRate, formatRatePercent, parseDecimalRate } from './fee-rate.utils';

/**
 * Chaque test fixe une lecture dont l'erreur se verrait sur un écran de frais :
 * un taux inventé, un taux caché, ou une queue de décimales.
 */
describe('parseDecimalRate', () => {
  it('reads the published base tiers', () => {
    expect(parseDecimalRate('0.00045')).toBe(0.00045);
    expect(parseDecimalRate('0.00015')).toBe(0.00015);
  });

  it('reads a maker rebate, which is negative', () => {
    /**
     * Un rebate est de l'argent **reçu**. Le refuser au nom de « un frais ne
     * peut pas être négatif » cacherait une recette — et la documentation en
     * publie, jusqu'à -0,003 %.
     */
    expect(parseDecimalRate('-0.00001')).toBe(-0.00001);
  });

  it('refuses an empty string rather than reading it as zero', () => {
    // `Number('')` rend `0`, soit un taux plausible : une réponse tronquée
    // passerait pour « aucun frais ».
    expect(parseDecimalRate('')).toBeNull();
  });

  it('refuses an absent value', () => {
    expect(parseDecimalRate(undefined)).toBeNull();
    expect(parseDecimalRate(null)).toBeNull();
  });

  it('refuses anything trailing after the number', () => {
    // `parseFloat('0.00045abc')` rendrait `0.00045` et avalerait la malformation.
    expect(parseDecimalRate('0.00045abc')).toBeNull();
  });

  it('refuses forms Hyperliquid has never sent', () => {
    // `Number` les accepterait toutes ; les accepter reviendrait à deviner ce
    // qu'un serveur a voulu dire.
    expect(parseDecimalRate(' 0.00045')).toBeNull();
    expect(parseDecimalRate('0.00045 ')).toBeNull();
    expect(parseDecimalRate('4.5e-4')).toBeNull();
    expect(parseDecimalRate('Infinity')).toBeNull();
    expect(parseDecimalRate('NaN')).toBeNull();
  });

  it('refuses a value that is not a string at all', () => {
    expect(parseDecimalRate(0.00045 as unknown as string)).toBeNull();
  });
});

describe('formatRatePercent', () => {
  it('writes a base tier as a percentage', () => {
    expect(formatRatePercent(0.00045)).toBe('0.045%');
    expect(formatRatePercent(0.00015)).toBe('0.015%');
  });

  it('writes a rebate with its sign', () => {
    expect(formatRatePercent(-0.00001)).toBe('-0.001%');
  });

  it('drops the tail of a floating-point product', () => {
    /**
     * ⚠️ Le palier de base **tombe juste** : `0.00045 * 100` vaut exactement
     * `0.045`. Éprouver l'arrondi sur lui ne prouve rien — c'est ce qui a laissé
     * survivre la même mutation ailleurs le 2026-10-11. Les paliers de volume,
     * eux, ne tombent pas juste.
     */
    expect(formatRatePercent(0.00035)).toBe('0.035%');
    expect(formatRatePercent(0.0007)).toBe('0.07%');
  });

  it('writes a zero rate as zero, not as an absence', () => {
    // Un palier maker nul existe (palier 4 et au-delà) : c'est un taux choisi.
    expect(formatRatePercent(0)).toBe('0%');
  });
});

describe('formatDecimalRate', () => {
  it('reads and writes in one step', () => {
    expect(formatDecimalRate('0.000315')).toBe('0.0315%');
  });

  it('gives null rather than a made-up rate', () => {
    // L'écran doit pouvoir montrer un trou. `'0%'` sur une réponse illisible
    // annoncerait la gratuité.
    expect(formatDecimalRate('')).toBeNull();
    expect(formatDecimalRate(undefined)).toBeNull();
  });
});
