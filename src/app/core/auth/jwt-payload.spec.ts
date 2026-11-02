import { decodeJwtPayload } from './jwt-payload';

const b64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

/**
 * Un jeton à la forme de ceux de nest-mongo-user (HS256, charge `sub`,
 * `wallet`, `username`, plus `iat` et `exp` ajoutés par @nestjs/jwt). La
 * signature est quelconque : l'app ne la vérifie pas.
 */
const tokenOf = (claims: unknown) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(claims))}.c2lnbmF0dXJl`;

const claims = {
  sub: '6650a1b2c3d4e5f6a7b8c9d0',
  wallet: '0x' + 'ab'.repeat(20),
  username: 'trader_zero',
  iat: 1_793_000_000,
  exp: 1_793_003_600,
};

describe('decodeJwtPayload', () => {
  it('should read the claims the app relies on', () => {
    expect(decodeJwtPayload(tokenOf(claims))).toEqual(claims);
  });

  it('should keep only the known claims', () => {
    expect(decodeJwtPayload(tokenOf({ ...claims, role: 'admin' }))).toEqual(claims);
  });

  it('should read a UTF-8 username', () => {
    const payload = decodeJwtPayload(tokenOf({ ...claims, username: 'élodie–🚀' }));
    expect(payload.username).toBe('élodie–🚀');
  });

  // Le défaut qui a motivé ce décodeur : sans `exp`, la session ne passait
  // jamais pour expirée.
  it.each([
    ['exp', { ...claims, exp: undefined }],
    ['exp', { ...claims, exp: '1793003600' }],
    ['iat', { ...claims, iat: null }],
    ['sub', { ...claims, sub: '' }],
    ['username', { ...claims, username: 42 }],
    ['wallet', { ...claims, wallet: '0x123' }],
    ['wallet', { ...claims, wallet: 'ab'.repeat(21) }],
  ])('should refuse a token whose "%s" is missing or malformed', (name, bad) => {
    expect(() => decodeJwtPayload(tokenOf(bad))).toThrow(
      `Invalid sign-in token: "${name}" is missing or malformed`,
    );
  });

  it.each([
    ['two segments', 'a.b'],
    ['four segments', 'a.b.c.d'],
    ['an empty string', ''],
  ])('should refuse %s', (_label, token) => {
    expect(() => decodeJwtPayload(token)).toThrow('Invalid sign-in token: expected 3 segments');
  });

  it.each([
    [
      'standard base64 characters',
      tokenOf(claims).replace(/\.([^.]*)\./, (_m, p: string) => `.${p}+/.`),
    ],
    ['padding', tokenOf(claims).replace(/\.([^.]*)\./, (_m, p: string) => `.${p}==.`)],
    // `e31` et `e30` donnent tous deux `{}` à `atob` : seul le ré-encodage voit l'écart.
    ['non-zero trailing bits', 'e30.e31.c2ln'],
    ['a payload that is not JSON', `e30.${b64url('not json')}.c2ln`],
    ['bytes that are not UTF-8', `e30.${btoa('\xff\xfe').replace(/=+$/, '')}.c2ln`],
  ])('should refuse %s', (_label, token) => {
    expect(() => decodeJwtPayload(token)).toThrow('Invalid sign-in token: unreadable payload');
  });

  it('should refuse a payload that is not an object', () => {
    expect(() => decodeJwtPayload(`e30.${b64url('[1,2]')}.c2ln`)).toThrow(
      'Invalid sign-in token: the payload is not an object',
    );
  });
});
