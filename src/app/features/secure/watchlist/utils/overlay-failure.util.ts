/**
 * ============================================================================
 * 🗣️ OVERLAY FAILURE
 * Pourquoi le chart est nu, dit sans se tromper de coupable.
 *
 * Un refus du bot n'est pas une panne : il répond, et il explique. Annoncer
 * « the analysis service did not respond » sur un `400` envoyait chercher du
 * côté du réseau un problème qui était dans la requête — exactement le genre de
 * diagnostic faux qu'on ne veut pas sur un outil de trading.
 *
 * La distinction est donc portée par une fonction pure, testable seule : c'est
 * une décision, et une décision n'a pas à vivre dans une méthode de page.
 * ============================================================================
 */

/** Forme utile d'une `HttpErrorResponse`, sans dépendre du type d'Angular. */
interface FailureLike {
  status?: number;
  error?: { message?: string; issues?: { message?: string }[] };
}

const UNREACHABLE = 'the analysis service did not respond.';

/**
 * Motif à afficher, en une phrase qui complète « Chart loaded without
 * indicators — … ».
 *
 * Seuls les `4xx` sont des refus : un `5xx` est une défaillance du service, et
 * un statut absent ou nul signale qu'on n'a même pas pu lui parler. Les deux
 * relèvent de la même phrase, parce que du point de vue de l'utilisateur ils ne
 * se distinguent pas — dans les deux cas, rien à corriger dans sa requête.
 */
export function overlayFailureReason(error: unknown): string {
  const failure = error as FailureLike | null;
  const status = failure?.status;

  if (typeof status !== 'number' || status < 400 || status >= 500) return UNREACHABLE;

  // Le rapport d'anomalies est ce qui rend le message actionnable : il nomme
  // l'opérande fautif, et souvent les valeurs acceptées.
  const issue = failure?.error?.issues?.[0]?.message;
  return `the bot refused the request: ${issue ?? failure?.error?.message ?? 'invalid request'}`;
}
