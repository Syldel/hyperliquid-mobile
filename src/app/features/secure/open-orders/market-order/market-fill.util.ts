import { HttpErrorResponse } from '@angular/common/http';
import { exchangeRefusal, extractErrorMessage } from '@utils/hl-error.utils';

/**
 * ============================================================================
 * Ce qu'il est advenu d'un ordre au marché, lu dans la réponse de `POST hyperliquid/order` (le
 * gateway relaie l'enveloppe d'Hyperliquid telle quelle).
 *
 * Trois familles, et l'écran ne les confond jamais :
 * - **rien n'a été exécuté** (`not-filled`, `refused`) : on peut réessayer, rien ne bloque ;
 * - **exécuté** (`filled`, `partial`) : ce qui est rempli est su, le reste d'un IOC est annulé ;
 * - **état inconnu** (`unknown`) : l'ordre a PEUT-ÊTRE été exécuté. Jamais de relance : on relit la
 *   position, une fois, et on la montre.
 *
 * ⚠️ Non mesuré (2026-11-12) : la forme exacte d'un IOC rempli EN PARTIE. On suppose
 * `filled: { totalSz < taille demandée }`, la forme d'un remplissage complet avec une taille
 * moindre ; un statut d'une autre forme tombe en `unknown`, jamais en succès.
 * ============================================================================
 */
export type MarketFillOutcome =
  | { kind: 'filled'; totalSz: string; avgPx: string; oid: number | null }
  | { kind: 'partial'; totalSz: string; avgPx: string; oid: number | null; requestedSz: string }
  | { kind: 'not-filled'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown'; message: string };

/** Le texte d'Hyperliquid pour un IOC qui ne trouve pas de contrepartie dans son prix. */
const IOC_NO_MATCH = /could not immediately match/i;

const MAY_HAVE_EXECUTED = 'The order may have executed: check the position before anything else.';

export function readMarketReply(reply: unknown, requestedSz: string): MarketFillOutcome {
  const refusal = exchangeRefusal(reply);
  if (refusal !== null) return { kind: 'refused', message: `${refusal} Nothing was executed.` };

  const envelope = reply as { status?: unknown; response?: { data?: { statuses?: unknown } } };
  const statuses = envelope?.response?.data?.statuses;
  if (envelope?.status !== 'ok' || !Array.isArray(statuses) || statuses.length === 0) {
    return {
      kind: 'unknown',
      message: `Unexpected answer from Hyperliquid: ${JSON.stringify(reply ?? null)}. ${MAY_HAVE_EXECUTED}`,
    };
  }

  const first: unknown = statuses[0];
  if (first !== null && typeof first === 'object') {
    const status = first as {
      error?: unknown;
      filled?: { totalSz?: unknown; avgPx?: unknown; oid?: unknown };
      resting?: { oid?: unknown };
    };

    if (typeof status.error === 'string' && status.error) {
      return IOC_NO_MATCH.test(status.error)
        ? {
            kind: 'not-filled',
            message: `Not filled: no liquidity within the max slippage. Nothing was executed. (${status.error})`,
          }
        : {
            kind: 'refused',
            message: `Refused by Hyperliquid: ${status.error} Nothing was executed.`,
          };
    }

    if (status.filled) {
      const totalSz = String(status.filled.totalSz ?? '');
      const avgPx = String(status.filled.avgPx ?? '');
      const oid = typeof status.filled.oid === 'number' ? status.filled.oid : null;
      const filled = Number(totalSz);
      const requested = Number(requestedSz);
      if (!(filled > 0) || !(Number(avgPx) > 0)) {
        return {
          kind: 'unknown',
          message: `Hyperliquid reported a fill without a size or price: ${JSON.stringify(first)}. ${MAY_HAVE_EXECUTED}`,
        };
      }
      // Une tolérance relative : `totalSz` revient formaté par l'exchange, pas recalculé ici.
      return filled < requested * (1 - 1e-9)
        ? { kind: 'partial', totalSz, avgPx, oid, requestedSz }
        : { kind: 'filled', totalSz, avgPx, oid };
    }

    if (status.resting) {
      // Un IOC ne repose pas. Si Hyperliquid le dit au repos, c'est une forme jamais vue : on ne la
      // range ni en succès ni en échec.
      return {
        kind: 'unknown',
        message: `Hyperliquid reported the order as resting (oid ${String(status.resting.oid)}), which an IOC should never be. Check the open orders and the position.`,
      };
    }
  }

  return {
    kind: 'unknown',
    message: `Unexpected order status from Hyperliquid: ${JSON.stringify(first)}. ${MAY_HAVE_EXECUTED}`,
  };
}

/**
 * Une erreur au lieu d'une réponse. Une `Error` levée avant l'appel, ou un 4xx du gateway (jeton
 * refusé, corps invalide) : rien n'est parti. Un réseau coupé (`0`) ou un 5xx : la requête a pu
 * atteindre l'exchange avant que la réponse se perde — l'état est inconnu.
 */
export function readMarketHttpError(err: HttpErrorResponse | Error): MarketFillOutcome {
  const message = extractErrorMessage(err);
  if (err instanceof Error) return { kind: 'refused', message: `${message} Nothing was sent.` };
  if (err.status === 0 || err.status >= 500) {
    return { kind: 'unknown', message: `${message} ${MAY_HAVE_EXECUTED}` };
  }
  return { kind: 'refused', message: `${message} Nothing was executed.` };
}
