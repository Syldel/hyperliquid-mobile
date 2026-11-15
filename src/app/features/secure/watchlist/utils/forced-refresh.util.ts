/**
 * Délai minimal entre deux rafraîchissements **forcés** du chart — ceux qui passent les caches.
 *
 * Un rafraîchissement forcé avec surcouches fait relire les bougies par le bot, donc par le gateway, dont
 * l'IP est **celle du bot de trading** : `candleSnapshot` y coûte 20 de poids, plus 1 par tranche de 60
 * bougies (`nest-hyperliquid-gateway/docs/rate-limits.md`). Dix appuis rapides ne la mettraient pas en
 * danger, mais rien ne justifie de les laisser partir.
 *
 * Pourquoi ce n'est pas mentir à l'utilisateur : dans les 10 s qui suivent un rafraîchissement forcé,
 * les données servies depuis le cache **ont moins de 10 s** — ce sont celles qu'il vient de recevoir.
 * Une marge large plutôt qu'une mesure fine : à 10 s, le chiffre ne change aucune décision.
 */
export const FORCED_REFRESH_COOLDOWN_MS = 10_000;

/**
 * Ce rafraîchissement peut-il passer les caches ?
 *
 * Oui s'il n'y en a pas eu depuis `FORCED_REFRESH_COOLDOWN_MS`, et **toujours** si le précédent a échoué :
 * le délai protège d'une répétition inutile, pas d'une nouvelle tentative — un échec n'a rien rangé dans
 * le cache qu'on pourrait servir à la place.
 */
export function mayForceRefresh(
  now: number,
  lastForcedAt: number | null,
  lastAttemptFailed: boolean,
  cooldownMs = FORCED_REFRESH_COOLDOWN_MS,
): boolean {
  if (lastAttemptFailed || lastForcedAt === null) return true;
  return now - lastForcedAt >= cooldownMs;
}
