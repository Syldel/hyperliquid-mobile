import { HttpErrorResponse } from '@angular/common/http';

/**
 * Le message affiché quand une connexion échoue.
 *
 * - **429** : nest-mongo-user limite les essais par compte et écrit lui-même
 *   combien de temps attendre (« Try again in 2 min. ») ; ce texte fait
 *   autorité et s'affiche tel quel. Un « Login failed (status: 429) » laissait
 *   réessayer à l'aveugle, ce qui ne sert à rien pendant l'attente.
 * - **une erreur qui n'est pas HTTP** : le jeton reçu a été refusé par
 *   `decodeJwtPayload`, dont le message nomme le champ en faute ; il
 *   s'affichait « status: undefined ».
 */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return 'Network error or CORS policy problem. (status: 0)';
    }
    const serverMessage = (err.error as { message?: unknown } | null)?.message;
    if (err.status === 429 && typeof serverMessage === 'string') {
      return serverMessage;
    }
    return `Login failed. Please try again. (status: ${err.status})`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Login failed. Please try again.';
}
