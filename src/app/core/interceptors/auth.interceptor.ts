import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';

import { AuthService } from '@auth/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly PUBLIC_ROUTES: string[] = ['/login'];

  constructor(private readonly auth: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.auth.currentUser()?.token;
    const isPublicRoute = this.PUBLIC_ROUTES.some((route) => {
      const routePattern = route.replace(/\*/g, '.*');
      const regex = new RegExp(`${routePattern}(\\?.*)?$`);
      return regex.test(req.url);
    });

    let clonedReq = req;
    if (token && !isPublicRoute) {
      clonedReq = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    return next.handle(clonedReq).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && !isPublicRoute) {
          console.warn('Unauthorized (401) - Logout...');
          this.auth.logout();
        } else if (error.status === 403) {
          console.warn('Forbidden (403) - Redirecting to access denied page...');
        }
        return throwError(() => error);
      }),
    );
  }
}
