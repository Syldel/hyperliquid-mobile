import { HttpErrorResponse } from '@angular/common/http';

export function extractErrorMessage(err: HttpErrorResponse): string {
  if (err.status === 0) return 'Network error.';
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
