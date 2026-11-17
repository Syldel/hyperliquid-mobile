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
  const reasons = validationReasons(body);
  if (reasons) return reasons;
  if (typeof body?.message === 'string' && body.message) return body.message;
  if (typeof body?.error === 'string' && body.error) return body.error;
  if (err.status === 401) return 'Unauthorized – please log in again.';
  if (err.status === 403) return 'Forbidden.';
  if (err.status === 404) return 'Resource not found.';
  if (err.status >= 500) return `Server error (${err.status}).`;
  return `Error ${err.status}`;
}

/**
 * La raison d'un 400 du gateway. Son filtre global (`ValidationExceptionFilter`) réécrit **tout** 400
 * en `{ message: 'Validation failed', errors }` : `errors` est la liste des champs refusés par le
 * ValidationPipe, ou le texte d'un refus du service (« a sell activates above the mark… », mesuré le
 * 2026-11-17). Lire `message` d'abord affichait « Validation failed » pour chacun, sans la raison.
 * ⚠️ Le code du refus (`TRAILING_STOP_ACTIVATION_WRONG_SIDE`…) est perdu par ce filtre, côté gateway.
 */
function validationReasons(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('errors' in body)) return null;
  const errors = (body as { errors: unknown }).errors;
  if (typeof errors === 'string') return errors || null;
  if (Array.isArray(errors)) {
    const texts = errors.filter((e): e is string => typeof e === 'string' && e !== '');
    return texts.length > 0 ? texts.join('; ') : null;
  }
  return null;
}

/**
 * Le refus **d'ensemble** d'une action `/exchange` : HTTP 200 et
 * `{ status: 'err', response: '<texte>' }`, que le gateway relaie tel quel.
 * C'est la forme d'un agent que Hyperliquid ne connaît pas (« User or API
 * Wallet 0x… does not exist. », 2026-10-29) comme d'un `modify` refusé
 * (2026-10-27). Rien n'y est dans `response.data.statuses`.
 *
 * Avant, chaque écran lisait `statuses` sans regarder `status` : un nouvel
 * ordre refusé s'annonçait « no response » puis enchaînait les ordres de
 * protection, une annulation refusée plantait sans rien afficher, et une
 * modification refusée disait seulement « Failed to update order. ».
 *
 * Rend le message à afficher, ou `null` si la réponse n'est pas un refus
 * d'ensemble — les refus **par ordre** restent dans `statuses`.
 */
export function exchangeRefusal(reply: unknown): string | null {
  const envelope = reply as { status?: unknown; response?: unknown } | null | undefined;
  if (envelope?.status !== 'err') return null;
  const text =
    typeof envelope.response === 'string' && envelope.response
      ? envelope.response
      : JSON.stringify(envelope.response ?? null);
  return `Refused by Hyperliquid: ${text}`;
}

/**
 * Termine une phrase par un point si elle n'a pas déjà sa ponctuation finale.
 *
 * Les textes de Hyperliquid n'en ont pas toujours : « Cannot modify canceled or filled order » n'a pas de point, « …
 * bbo was 73452@73453. » en a un. Collé tel quel devant une autre phrase, le premier a donné « … filled order Check the
 * open orders » à l'écran (vu le 2026-11-12, mesure 7).
 */
export function asSentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Le refus d'un `modify`, quel que soit le niveau où l'exchange le range.
 *
 * Mesuré sur le mainnet : un `modify` seul refusé répond par un refus d'ensemble (`status: 'err'`,
 * 2026-10-27 et 2026-11-09), mais le MÊME refus, dans un `batchModify`, arrive dans une réponse
 * `ok`, en `statuses[i].error` (2026-11-09). Cette seconde forme n'a jamais été vue pour un
 * `modify` seul ; rien ne garantit qu'elle n'y arrivera pas. Un écran qui ne lit que
 * `status === 'ok'` l'annoncerait « Order updated », alors que dans chaque cas mesuré l'ordre
 * visé n'existait plus après le refus.
 *
 * Rend le message à afficher, ou `null` si la réponse ne porte aucun refus.
 */
export function modifyRefusal(reply: unknown): string | null {
  const whole = exchangeRefusal(reply);
  if (whole !== null) return whole;

  const envelope = reply as { response?: { data?: { statuses?: unknown } } } | null | undefined;
  const statuses = envelope?.response?.data?.statuses;
  const first: unknown = Array.isArray(statuses) ? statuses[0] : undefined;
  const error =
    first !== null && typeof first === 'object' ? (first as { error?: unknown }).error : undefined;
  if (error === undefined || error === null || error === '') return null;
  return `Refused by Hyperliquid: ${typeof error === 'string' ? error : JSON.stringify(error)}`;
}
