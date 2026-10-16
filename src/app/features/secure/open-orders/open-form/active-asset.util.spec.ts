import type { HlActiveAssetData } from '@syldel/hl-shared-types';
import {
  ACTIVE_ASSET_UNAVAILABLE,
  blocksPlacement,
  isNoAssetSelected,
  marketDataNotice,
  marketDataStateOf,
  NO_ASSET_SELECTED,
  PRICE_CHECK_UNSUPPORTED,
  readActiveAsset,
} from './active-asset.util';

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

/**
 * Quand `activeAssetData` échoue, le formulaire disparaissait derrière « No data found »
 * (mesuré le 2026-10-16), sans toast, avec la cause dans la console seulement — et le prix
 * de l'actif précédent restait en mémoire. Sans prix, `isPriceInvalid` rend `false` : le
 * garde-fou « un achat limite ne passe pas au-dessus du marché » cesse de s'exercer. Le
 * formulaire reste donc affiché, **dit** pourquoi, et bloque l'envoi.
 */
describe('a failed or unsupported price lookup', () => {
  describe('readActiveAsset', () => {
    it('reads the failure marker as unavailable — not as "nothing", which would hide the failure', () => {
      expect(readActiveAsset(ACTIVE_ASSET_UNAVAILABLE)).toEqual({ status: 'unavailable' });
    });

    it('reads the spot marker as unsupported', () => {
      expect(readActiveAsset(PRICE_CHECK_UNSUPPORTED)).toEqual({ status: 'unsupported' });
    });
  });

  describe('the markers', () => {
    it('are frozen and distinct from each other and from "no asset selected"', () => {
      for (const marker of [ACTIVE_ASSET_UNAVAILABLE, PRICE_CHECK_UNSUPPORTED, NO_ASSET_SELECTED]) {
        expect(Object.isFrozen(marker)).toBe(true);
      }
      expect(ACTIVE_ASSET_UNAVAILABLE).not.toBe(PRICE_CHECK_UNSUPPORTED);
      expect(ACTIVE_ASSET_UNAVAILABLE).not.toBe(NO_ASSET_SELECTED);
    });

    it('are not mistaken for each other', () => {
      expect(isNoAssetSelected(ACTIVE_ASSET_UNAVAILABLE)).toBe(false);
      expect(isNoAssetSelected(PRICE_CHECK_UNSUPPORTED)).toBe(false);
    });
  });

  describe('marketDataStateOf', () => {
    it.each([
      ['ok', { status: 'ok', price: 1, leverage }, 'ok'],
      ['unreadable-price', { status: 'unreadable-price', raw: 'abc', leverage }, 'unavailable'],
      ['unavailable', { status: 'unavailable' }, 'unavailable'],
      ['unsupported', { status: 'unsupported' }, 'unsupported'],
    ] as const)('maps a "%s" reading to the state %s', (_label, reading, expected) => {
      expect(marketDataStateOf(reading)).toBe(expected);
    });

    // `none` = « rien à lire » : l'état en place ne bouge pas, donc pas d'état à imposer.
    it('leaves the state alone on "none"', () => {
      expect(marketDataStateOf({ status: 'none' })).toBeNull();
    });
  });

  describe('blocksPlacement', () => {
    it.each([
      ['none', false],
      ['ok', false],
      ['unavailable', true],
      ['unsupported', true],
    ] as const)('for the state %s answers %s', (state, expected) => {
      expect(blocksPlacement(state)).toBe(expected);
    });
  });

  describe('marketDataNotice', () => {
    it('says nothing when there is nothing to say', () => {
      expect(marketDataNotice('none')).toBeNull();
      expect(marketDataNotice('ok')).toBeNull();
    });

    it('explains an unavailable price and what it costs', () => {
      expect(marketDataNotice('unavailable')).toMatch(
        /could not be loaded.*price check.*disabled/i,
      );
    });

    it('explains the spot case differently, since retrying cannot help', () => {
      const spot = marketDataNotice('unsupported');

      expect(spot).toMatch(/spot/i);
      expect(spot).not.toBe(marketDataNotice('unavailable'));
    });

    // Tout état qui bloque doit avoir un message : un bouton désactivé sans raison dite
    // est précisément la défaillance muette qu'on corrige.
    it.each(['unavailable', 'unsupported'] as const)(
      'has a message for every state that blocks (%s)',
      (state) => {
        expect(blocksPlacement(state)).toBe(true);
        expect(marketDataNotice(state)).not.toBeNull();
      },
    );
  });
});
