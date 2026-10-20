import { HttpErrorResponse } from '@angular/common/http';
import { extractErrorMessage } from './hl-error.utils';

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
