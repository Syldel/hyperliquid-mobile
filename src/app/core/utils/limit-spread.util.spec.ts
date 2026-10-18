import {
  LIMIT_SPREAD_SL,
  LIMIT_SPREAD_TP,
  limitSpread,
  marketTriggerBound,
} from './limit-spread.util';

/**
 * Les écarts d'un déclencheur LIMITE sont des choix (valeurs validées par l'utilisateur le
 * 2026-10-16) ; la borne d'un déclencheur AU MARCHÉ est celle que l'exchange calcule lui-même
 * (mesuré le 2026-10-18, voir `limit-spread.util.ts`).
 */
describe('limitSpread', () => {
  it('is wide for a stop loss limit (5 %) and tight for a take profit limit (1.5 %)', () => {
    expect(limitSpread('sl')).toBe(LIMIT_SPREAD_SL);
    expect(limitSpread('tp')).toBe(LIMIT_SPREAD_TP);
    expect(LIMIT_SPREAD_SL).toBe(0.05);
    expect(LIMIT_SPREAD_TP).toBe(0.015);
  });
});

describe('marketTriggerBound', () => {
  const bound = (triggerPx: string, isBuy: boolean, szDecimals = 5, isSpot = false) =>
    marketTriggerBound({ triggerPx, isBuy, szDecimals, isSpot });

  /**
   * Des ordres déclenchés RÉELS, relevés dans `historicalOrders` du compte le 2026-10-18 : le
   * `limitPx` de la ligne `filled`, écrit par l'exchange, recopié. Les attendus ne sont pas
   * calculés ici : s'ils tombent, c'est que notre borne s'est écartée de la sienne.
   */
  describe('matches what the exchange wrote on triggered market orders', () => {
    it.each([
      // BTC (szDecimals 5) : 5 chiffres significatifs, donc un entier.
      ['BTC sell', '81838', false, 5, '73655'],
      ['BTC sell', '81937', false, 5, '73744'],
      ['BTC sell', '78009', false, 5, '70209'],
      ['BTC sell', '75386', false, 5, '67848'],
      ['BTC buy', '77724', true, 5, '85496'],
      ['BTC buy', '77761', true, 5, '85537'],
      ['BTC buy', '78373', true, 5, '86210'],
      ['BTC buy', '71127', true, 5, '78239'],
      // SOL (szDecimals 2) : 5 chiffres significatifs, trois décimales.
      ['SOL sell', '85.014', false, 2, '76.513'],
      ['SOL sell', '85.347', false, 2, '76.813'],
      ['SOL buy', '82.717', true, 2, '90.988'],
      ['SOL buy', '84.329', true, 2, '92.761'],
    ])('%s %s', (_label, triggerPx, isBuy, szDecimals, expected) => {
      expect(bound(triggerPx, isBuy, szDecimals)).toBe(expected);
    });
  });

  it('truncates a buy, and raises a sell by one tick after truncating it', () => {
    // 81838 × 0,9 = 73654,2 : tronqué 73654, plus un tick : 73655 (et non 73654, ce que donnerait
    // un arrondi au plus proche ou une troncature — ce que l'exchange n'écrit pas).
    expect(bound('81838', false)).toBe('73655');
    // 77724 × 1,1 = 85496,4 : tronqué, 85496.
    expect(bound('77724', true)).toBe('85496');
  });

  it('raises a sell by one tick even when the product is exact, and leaves an exact buy alone', () => {
    // Les deux produits exacts de l'historique du compte (2026-10-18), recopiés : 78130 × 0,9 =
    // 70317 exactement et l'exchange écrit 70318 ; 79960 × 1,1 = 87956 exactement et il écrit 87956.
    expect(bound('78130', false)).toBe('70318');
    expect(bound('79960', true)).toBe('87956');
    // Même règle sur un déclencheur rond : 81000 × 0,9 = 72900, relevé à 72901 ; × 1,1 = 89100.
    expect(bound('81000', false)).toBe('72901');
    expect(bound('81000', true)).toBe('89100');
  });

  it('is 10 % under the trigger of a sell and 10 % over the trigger of a buy, give or take a tick', () => {
    expect(Number(bound('10000', false))).toBeCloseTo(9000, -1);
    expect(Number(bound('10000', true))).toBe(11000);
  });

  it('does the arithmetic exactly: no floating point noise decides the last digit', () => {
    // 129,2 × 0,9 = 116,28 : tronqué à 116.28, plus un tick (deux décimales permises ici : 3 chiffres
    // significatifs avant la virgule sur 5) → 116.29. Un produit flottant 116,27999999999999 serait
    // tronqué à 116.27, plus un tick, 116.28 : un tick de travers.
    expect(bound('129.2', false, 2)).toBe('116.29');
  });

  it('respects the spot grid: up to 8 - szDecimals decimals, five significant figures', () => {
    // 0,123456 × 0,9 = 0,1111104 : cinq chiffres significatifs → 0,11111 ; vente, plus un tick : 0,11112.
    expect(bound('0.123456', false, 2, true)).toBe('0.11112');
  });

  it('caps the decimals by the size decimals on a perp', () => {
    // szDecimals 5 : une seule décimale permise sur un prix perp, quand les chiffres significatifs
    // en autoriseraient davantage. 10,5 × 0,9 = 9,45 : tronqué 9.4, plus un tick : 9.5.
    expect(bound('10.5', false, 5)).toBe('9.5');
  });

  it.each([['abc'], [''], ['-5'], ['1e5'], ['0'], ['0.0']])(
    'has nothing to propose for %j',
    (triggerPx) => {
      expect(bound(triggerPx, false)).toBe('');
    },
  );
});
