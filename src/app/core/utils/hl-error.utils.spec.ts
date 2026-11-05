import { HttpErrorResponse } from '@angular/common/http';
import { exchangeRefusal, extractErrorMessage } from './hl-error.utils';

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
