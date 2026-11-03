import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Une URL de service est-elle acceptable ? `https://` toujours ; `http://`
 * seulement vers la machine elle-même ou un réseau local (RFC 1918), utiles en
 * développement (`ng serve`, émulateur Android en 10.0.2.2, téléphone sur le
 * Wi-Fi du PC).
 *
 * L'écran de configuration acceptait `http://` vers n'importe quel hôte : une
 * URL de production mal saisie faisait passer le mot de passe à la connexion,
 * puis le jeton à chaque requête, en clair sur le réseau.
 */
export function isAcceptableServiceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return isLocalHost(url.hostname);
}

function isLocalHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '[::1]') return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 127 || // la machine elle-même
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Le validateur de formulaire : erreur `insecureUrl` si l'URL est refusée. */
export const serviceUrlValidator: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null =>
  !control.value || isAcceptableServiceUrl(control.value) ? null : { insecureUrl: true };
