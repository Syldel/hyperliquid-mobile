import { HttpErrorResponse } from '@angular/common/http';
import { loginErrorMessage } from './login-error-message';

const httpError = (status: number, error: unknown = null) =>
  new HttpErrorResponse({ status, error, url: 'http://api.test/auth/login' });

describe('loginErrorMessage', () => {
  // Le corps qu'écrit nest-mongo-user (LoginThrottledFilter).
  it('should show the waiting time the server wrote on a 429', () => {
    const err = httpError(429, {
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many failed sign-in attempts. Try again in 2\u00a0min.',
      retryAfterSeconds: 91,
    });
    expect(loginErrorMessage(err)).toBe(
      'Too many failed sign-in attempts. Try again in 2\u00a0min.',
    );
  });

  it('should show the disabled sign-in message as written', () => {
    const message =
      'Sign-in is disabled after 100 failed attempts in a row. An administrator must unlock it.';
    expect(loginErrorMessage(httpError(429, { statusCode: 429, message }))).toBe(message);
  });

  it('should fall back to the status on a 429 without a message', () => {
    expect(loginErrorMessage(httpError(429))).toBe('Login failed. Please try again. (status: 429)');
  });

  // Un 401 garde le message générique : le serveur répond pareil pour un
  // compte inconnu et un mauvais mot de passe, l'app n'a rien à préciser.
  it('should keep the generic message on a 401', () => {
    expect(loginErrorMessage(httpError(401, { message: 'Invalid credentials' }))).toBe(
      'Login failed. Please try again. (status: 401)',
    );
  });

  it('should name a network failure', () => {
    expect(loginErrorMessage(httpError(0))).toBe(
      'Network error or CORS policy problem. (status: 0)',
    );
  });

  it('should show why the received token was refused', () => {
    const err = new Error('Invalid sign-in token: "exp" is missing or malformed');
    expect(loginErrorMessage(err)).toBe('Invalid sign-in token: "exp" is missing or malformed');
  });
});
