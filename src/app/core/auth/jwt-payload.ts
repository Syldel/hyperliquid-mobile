import { JwtPayload } from '@models/auth.interfaces';

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Lit la charge d'un jeton de connexion émis par nest-mongo-user, et vérifie
 * qu'elle a la forme dont l'app dépend.
 *
 * Elle ne vérifie **pas** la signature, et ne le doit pas : il faudrait le
 * secret HS256 du service, et un secret embarqué dans l'app se lit dans le
 * paquet. Le serveur vérifie le jeton à chaque appel et fait autorité ; l'app
 * ne s'en sert que pour savoir quel wallet afficher et quand la session finit.
 *
 * Remplace `jwt-decode`, qui ne validait rien : son type générique n'était
 * qu'une conversion, et un jeton sans `exp` donnait `exp * 1000 - now = NaN`,
 * que `NaN <= 0` ne tenait jamais pour expiré.
 */
export function decodeJwtPayload(token: string): JwtPayload {
  const segments = typeof token === 'string' ? token.split('.') : [];
  if (segments.length !== 3) {
    throw new Error('Invalid sign-in token: expected 3 segments');
  }

  let claims: unknown;
  try {
    claims = JSON.parse(base64urlToUtf8(segments[1]));
  } catch {
    throw new Error('Invalid sign-in token: unreadable payload');
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    throw new Error('Invalid sign-in token: the payload is not an object');
  }

  const { sub, username, wallet, exp, iat } = claims as Record<string, unknown>;
  if (typeof sub !== 'string' || sub === '') throw invalidClaim('sub');
  if (typeof username !== 'string' || username === '') throw invalidClaim('username');
  if (typeof wallet !== 'string' || !WALLET_PATTERN.test(wallet)) throw invalidClaim('wallet');
  if (typeof exp !== 'number' || !Number.isFinite(exp)) throw invalidClaim('exp');
  if (typeof iat !== 'number' || !Number.isFinite(iat)) throw invalidClaim('iat');

  // Seuls ces champs sont rendus : la charge est stockée telle quelle avec
  // les wallets, rien de ce que le serveur ajouterait n'y entre sans être lu.
  return { sub, username, wallet, exp, iat };
}

function invalidClaim(name: string): Error {
  return new Error(`Invalid sign-in token: "${name}" is missing or malformed`);
}

/**
 * base64url strict : `atob` accepte d'autres écritures (blancs, remplissage,
 * bits de fin non nuls), refusées ici par un ré-encodage qui doit retomber
 * sur l'entrée. Les octets sont lus en UTF-8 strict.
 */
function base64urlToUtf8(segment: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('not base64url');
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const canonical = btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (canonical !== segment) throw new Error('not canonical base64url');

  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
