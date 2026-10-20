import { HttpErrorResponse } from '@angular/common/http';

/**
 * Le message d'une erreur, pour un toast ou un bandeau.
 *
 * Deux familles arrivent ici : la réponse HTTP d'un service (`HttpErrorResponse`), et une `Error`
 * ordinaire levée **avant** tout appel — `getAssetIndex` qui ne résout pas un marché, par exemple. Cette
 * dernière n'a pas de `status` : elle tombait dans le repli final et affichait « Error undefined », sans
 * rien dire de la cause. `HttpErrorResponse` n'hérite pas d'`Error` (il l'implémente seulement), donc
 * `instanceof Error` sépare bien les deux.
 */
export function extractErrorMessage(err: HttpErrorResponse | Error): string {
  if (err instanceof Error) {
    return err.message || `Unexpected ${err.name || 'error'}, with no message.`;
  }
  if (err.status === 0) {
    return 'Network error (offline, DNS failure, CORS restriction, SSL error, timeout, or server unreachable).';
  }
  const body = err.error;
  if (typeof body === 'string' && body) return body;
  if (typeof body?.message === 'string' && body.message) return body.message;
  if (typeof body?.error === 'string' && body.error) return body.error;
  if (err.status === 401) return 'Unauthorized – please log in again.';
  if (err.status === 403) return 'Forbidden.';
  if (err.status === 404) return 'Resource not found.';
  if (err.status >= 500) return `Server error (${err.status}).`;
  return `Error ${err.status}`;
}
