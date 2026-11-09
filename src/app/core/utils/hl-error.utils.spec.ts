import { HttpErrorResponse } from '@angular/common/http';
import { exchangeRefusal, extractErrorMessage, modifyRefusal } from './hl-error.utils';

/**
 * ============================================================================
 * LE MESSAGE D'UNE ERREUR QUI N'EST PAS HTTP
 *
 * `extractErrorMessage` lisait `err.status` : sur une `Error` ordinaire — celle que lève ou que
 * transmet `getAssetIndex` quand le marché ne se résout pas, avant tout appel réseau —, `status` est
 * `undefined`, aucune branche ne correspond, et le repli rendait **« Error undefined »**. Annuler un
 * ordre dont le nom ne se résout pas affichait donc ce texte, qui ne dit rien de la cause.
 * ============================================================================
 */
describe('extractErrorMessage', () => {
  const http = (status: number, error?: unknown) =>
    new HttpErrorResponse({ status, error, statusText: 'x', url: 'http://gateway/x' });

  describe('an HTTP failure', () => {
    it('says the network could not be reached for status 0', () => {
      expect(extractErrorMessage(http(0))).toContain('Network error');
    });

    it('prefers what the server said: a text body, then message, then error', () => {
      expect(extractErrorMessage(http(400, 'bad asset'))).toBe('bad asset');
      expect(extractErrorMessage(http(400, { message: 'asset is required' }))).toBe(
        'asset is required',
      );
      expect(extractErrorMessage(http(400, { error: 'no such market' }))).toBe('no such market');
    });

    it.each([
      [401, 'Unauthorized – please log in again.'],
      [403, 'Forbidden.'],
      [404, 'Resource not found.'],
      [500, 'Server error (500).'],
      [418, 'Error 418'],
    ])('falls back on the status %i when the body says nothing', (status, message) => {
      expect(extractErrorMessage(http(status))).toBe(message);
    });
  });

  describe('an error that never reached the network', () => {
    it('gives its own message instead of "Error undefined"', () => {
      const error = new Error('Cannot resolve the asset index of "#10": it is an outcome market');

      expect(extractErrorMessage(error)).toBe(
        'Cannot resolve the asset index of "#10": it is an outcome market',
      );
    });

    it('still says something when the error carries no message', () => {
      expect(extractErrorMessage(new Error(''))).not.toContain('undefined');
    });
  });
});

describe('exchangeRefusal', () => {
  // La forme mesurée le 2026-10-29 pour un agent inconnu de Hyperliquid.
  it('names a whole-action refusal with the exchange text', () => {
    expect(
      exchangeRefusal({
        status: 'err',
        response: 'User or API Wallet 0x18176fd945515d65b66f3c524278c6cd76202d17 does not exist.',
      }),
    ).toBe(
      'Refused by Hyperliquid: User or API Wallet 0x18176fd945515d65b66f3c524278c6cd76202d17 does not exist.',
    );
  });

  // Une forme non documentée ne doit pas s'effacer : elle s'écrit telle quelle.
  it('still says something when the refusal carries no text', () => {
    expect(exchangeRefusal({ status: 'err' })).toBe('Refused by Hyperliquid: null');
    expect(exchangeRefusal({ status: 'err', response: { code: 7 } })).toBe(
      'Refused by Hyperliquid: {"code":7}',
    );
  });

  // Les refus par ordre vivent dans `statuses` : ce n'est pas un refus d'ensemble.
  it('leaves an accepted envelope, even with per-order errors, to its statuses', () => {
    expect(
      exchangeRefusal({
        status: 'ok',
        response: { type: 'order', data: { statuses: [{ error: 'Insufficient margin' }] } },
      }),
    ).toBeNull();
  });

  it.each([null, undefined, 'err', 42])('ignores a reply that is not an envelope (%p)', (reply) => {
    expect(exchangeRefusal(reply)).toBeNull();
  });
});

describe('modifyRefusal', () => {
  // Les textes et les formes viennent des mesures du 2026-10-27 et du 2026-11-09 (mainnet).
  const crossing =
    'Error placing new order during modify: Post only order would have immediately matched, bbo was 74940@74941.';

  it('names a single modify refused as a whole, as measured', () => {
    expect(
      modifyRefusal({
        status: 'err',
        response: 'Error placing new order during modify: Order must have minimum value of $10.',
      }),
    ).toBe(
      'Refused by Hyperliquid: Error placing new order during modify: Order must have minimum value of $10.',
    );
  });

  // La forme du même refus dans un `batchModify` : un `ok` qui n'est pas un succès.
  it('names a refusal carried by an accepted envelope, in its first status', () => {
    expect(
      modifyRefusal({
        status: 'ok',
        response: { type: 'order', data: { statuses: [{ error: crossing }] } },
      }),
    ).toBe(`Refused by Hyperliquid: ${crossing}`);
  });

  it('writes a refusal that is not text as it came', () => {
    expect(
      modifyRefusal({ status: 'ok', response: { data: { statuses: [{ error: { code: 7 } }] } } }),
    ).toBe('Refused by Hyperliquid: {"code":7}');
  });

  it.each([
    ['an ok with no statuses', { status: 'ok', response: { type: 'default' } }],
    [
      'a resting order',
      { status: 'ok', response: { data: { statuses: [{ resting: { oid: 1 } }] } } },
    ],
    ['a plain string status', { status: 'ok', response: { data: { statuses: ['success'] } } }],
    ['an empty error', { status: 'ok', response: { data: { statuses: [{ error: '' }] } } }],
    ['no reply', null],
  ])('finds no refusal in %s', (_label, reply) => {
    expect(modifyRefusal(reply)).toBeNull();
  });
});
