import type { HlActiveAssetData } from '@syldel/hl-shared-types';
import { isNoAssetSelected, NO_ASSET_SELECTED, readActiveAsset } from './active-asset.util';

const leverage = { type: 'cross', value: 10 } as const;

const asset = (markPx: unknown): HlActiveAssetData =>
  ({
    user: '0xabc',
    coin: 'BTC',
    leverage,
    maxTradeSzs: ['1', '1'],
    availableToTrade: ['1', '1'],
    markPx,
  }) as unknown as HlActiveAssetData;

/**
 * Le formulaire d'ordre affichait « NaN » dans « Limit price » tant qu'aucun actif
 * n'était choisi : un faux relevé `{ fake: true }` passait par `parseFloat(undefined)`.
 * Chaque test nomme un cas où une valeur illisible devait finir en `NaN`.
 */
describe('readActiveAsset', () => {
  describe('when there is nothing to read', () => {
    it('reads null as nothing, leaving the current state alone', () => {
      expect(readActiveAsset(null)).toEqual({ status: 'none' });
    });

    it('reads the "no asset selected" marker as nothing — never as a price', () => {
      expect(readActiveAsset(NO_ASSET_SELECTED)).toEqual({ status: 'none' });
    });
  });

  describe('a real answer', () => {
    it('reads the mark price as a number and carries the leverage', () => {
      expect(readActiveAsset(asset('49990.5'))).toEqual({
        status: 'ok',
        price: 49990.5,
        leverage,
      });
    });

    it('accepts an integer price', () => {
      expect(readActiveAsset(asset('103'))).toMatchObject({ status: 'ok', price: 103 });
    });

    it('accepts a very small price: it is not zero', () => {
      expect(readActiveAsset(asset('0.00000123'))).toMatchObject({
        status: 'ok',
        price: 0.00000123,
      });
    });
  });

  describe('a mark price that is not a price', () => {
    // `Number('')` vaut 0 : lu sans vérifier, un markPx vide devenait « un prix de zéro ».
    it.each([
      ['an empty string', ''],
      ['text', 'abc'],
      ['a number followed by text, which parseFloat would read as 12', '12abc'],
      ['a price padded with spaces', ' 5 '],
      ['scientific notation', '1e5'],
      ['a negative number', '-5'],
      ['zero, which is not a market price', '0'],
      ['zero written with decimals', '0.00'],
      ['undefined', undefined],
      ['null', null],
      ['a number instead of a string', 49990],
      ['an object', { price: '1' }],
    ])('refuses %s instead of producing NaN or 0', (_label, markPx) => {
      const reading = readActiveAsset(asset(markPx));

      expect(reading.status).toBe('unreadable-price');
      expect(reading).not.toHaveProperty('price');
    });

    it('keeps what it received, so the log can say what the exchange sent', () => {
      expect(readActiveAsset(asset('abc'))).toMatchObject({
        status: 'unreadable-price',
        raw: 'abc',
      });
    });

    it('still carries the leverage, which does not depend on the price', () => {
      expect(readActiveAsset(asset('abc'))).toMatchObject({ leverage });
    });
  });
});

describe('the "no asset selected" marker', () => {
  it('is recognised by isNoAssetSelected, and a real answer is not', () => {
    expect(isNoAssetSelected(NO_ASSET_SELECTED)).toBe(true);
    expect(isNoAssetSelected(asset('1'))).toBe(false);
    expect(isNoAssetSelected(null)).toBe(false);
  });

  // Un objet non gelé pourrait recevoir un `markPx` et se faire passer pour un relevé.
  it('is frozen, so nobody can turn it into a fake market reading', () => {
    expect(Object.isFrozen(NO_ASSET_SELECTED)).toBe(true);
    expect(() => {
      (NO_ASSET_SELECTED as unknown as Record<string, unknown>)['markPx'] = '1';
    }).toThrow(TypeError);
  });

  it('is a distinct object from a copy with the same shape', () => {
    expect(isNoAssetSelected({ kind: 'no-asset-selected' } as never)).toBe(false);
  });
});
