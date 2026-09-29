import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ConfigService } from '@services/config.service';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '@auth/auth.service';

/**
 * Les routes que l'on interroge sans jeton, comparées à la **fin du chemin**,
 * query retirée. Aujourd'hui la seule est la connexion : y présenter l'ancien
 * jeton pour en demander un nouveau n'aurait pas de sens.
 *
 * Ni motif ni joker. La version précédente compilait une `RegExp` par entrée
 * et par requête, en y remplaçant les astérisques par « n'importe quoi » :
 * elle traitait une chaîne comme un motif sans que personne l'ait demandé.
 * Deux conséquences, mesurées le 2026-09-29 :
 *
 * - l'expression s'appliquait à l'**URL entière**, query comprise. Une route
 *   privée du genre `/auth/me?redirect=/login` passait donc pour publique et
 *   partait sans jeton. Aucun appel de l'app ne construit de query
 *   aujourd'hui, le piège attendait le premier `?returnUrl=` ;
 * - un métacaractère dans une future entrée changeait silencieusement le
 *   sens : `/v1.0/login` aurait aussi accepté `/v1X0/login`.
 *
 * Si un vrai motif devient nécessaire, il faudra échapper les parties
 * littérales, pas seulement remplacer `*`.
 */
const UNAUTHENTICATED_ROUTES: readonly string[] = ['/login'];

/**
 * `url` tombe-t-elle sous `base` ?
 *
 * Deux pièges que `startsWith` seul ne voit pas, et que les tests gardent :
 *
 * - une **base vide** — le cas du build de production tant que l'utilisateur
 *   n'a pas saisi ses URL — rendrait `startsWith` vrai pour *toute* URL
 *   relative, donc montrerait le jeton à n'importe quel `/assets/…` ;
 * - une base qui **préfixe** une autre origine : `http://localhost:3010` ne
 *   doit pas autoriser `http://localhost:30100`, ni
 *   `https://user.mondomaine.fr` autoriser
 *   `https://user.mondomaine.fr.attaquant.net`. D'où la frontière explicite
 *   sur le `/` qui suit.
 */
function coveredBy(url: string, base: string): boolean {
  const origin = base.replace(/\/+$/, '');
  if (!origin) return false;
  return url === origin || url.startsWith(`${origin}/`);
}

/**
 * Le service auquel cette requête s'adresse vérifie-t-il notre jeton ?
 *
 * On identifie **le** destinataire avant de décider : celui dont la base
 * correspond *le plus longuement*. Se contenter de « l'une des deux bases de
 * confiance préfixe l'URL » suffit tant que chaque service a son sous-domaine,
 * et casse dès qu'ils partagent un hôte — topologie banale en production.
 * Mesuré le 2026-09-29 sur neuf configurations : avec
 * `userServiceUrl = https://api.exemple.fr` et
 * `botServiceUrl = https://api.exemple.fr/bot`, la comparaison naïve donnait le
 * jeton au bot, dont l'URL commence bel et bien par celle du service
 * utilisateur.
 *
 * À **égalité** de longueur — deux services configurés sur la même base, ce qui
 * est incohérent mais saisissable — on ne devine pas : le jeton ne part pas.
 */
function goesToATokenValidator(url: string, config: ConfigService): boolean {
  const services: readonly { base: string; validatesToken: boolean }[] = [
    { base: config.userServiceUrl, validatesToken: true },
    { base: config.hyperliquidGatewayUrl, validatesToken: true },
    { base: config.botServiceUrl, validatesToken: false },
    { base: config.hyperliquidPublicUrl, validatesToken: false },
  ];

  let best: { length: number; validatesToken: boolean } | null = null;

  for (const { base, validatesToken } of services) {
    if (!coveredBy(url, base)) continue;
    const length = base.replace(/\/+$/, '').length;

    if (!best || length > best.length) {
      best = { length, validatesToken };
    } else if (length === best.length) {
      best.validatesToken = best.validatesToken && validatesToken;
    }
  }

  return best?.validatesToken ?? false;
}

/**
 * Joint le jeton du wallet courant aux requêtes sortantes — **et seulement à
 * celles des services qui le valident**.
 *
 * Deux services, et pas un de plus :
 *
 * - le **service utilisateur**, qui émet le jeton (`/auth/me`,
 *   `/auth/strategy`) ;
 * - le **gateway**, dont les contrôleurs d'ordres, de trade, d'info et de
 *   fills portent `UserAuthGuard` et vérifient la signature avec le même
 *   `JWT_USER_SECRET` (`nest-hyperliquid-gateway`,
 *   `src/common/guards/user-auth.guard.ts`). Le priver de l'en-tête casserait
 *   le trading.
 *
 * Le **bot** ne pose aucun garde sur les routes consommées ici, et
 * `api.hyperliquid.xyz` est un **tiers** : jusqu'au 2026-09-29 tous deux
 * recevaient le JWT, parce que le seul filtre était « l'URL ne finit pas par
 * `/login` ». Un jeton transmis à un tiers est un jeton qu'on ne contrôle
 * plus — il vit désormais dans ses journaux.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const config = inject(ConfigService);
  const token = auth.currentToken();

  const path = req.url.split('?')[0];
  const isUnauthenticatedRoute = UNAUTHENTICATED_ROUTES.some((route) => path.endsWith(route));

  const validatesOurToken = goesToATokenValidator(req.url, config);

  const outgoing =
    token && validatesOurToken && !isUnauthenticatedRoute
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(outgoing).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isUnauthenticatedRoute) {
        // La déconnexion automatique est **délibérément** désactivée : on se
        // connecte une fois pour mémoriser l'adresse du wallet, et `/secure`
        // reste consultable ensuite sans jeton valide, l'essentiel de ce qui
        // s'y lit venant de l'API publique Hyperliquid. Déconnecter sur un 401
        // éjecterait l'utilisateur d'écrans qui n'avaient pas besoin de lui.
        //
        // Les deux appels ci-dessous existent et fonctionnent — c'est leur
        // usage ici qui est écarté, pas leur disponibilité. Ne pas les
        // réactiver sans changer l'architecture de session :
        // docs/ecosystem.md#le-modèle-de-session--une-adresse-mémorisée-un-jeton-optionnel
        // `auth.interceptor.spec.ts` fige ce choix par un test.
        console.warn('Unauthorized (401) - Logout...');
        // auth.logout();
        // auth.removeTokenIfExpired(auth.currentAddress() || '');
      } else if (error.status === 403) {
        // ⚠️ Ce message annonce une redirection qui n'existe pas. Conservé tel
        // quel sur décision de l'utilisateur ; l'intercepteur ne fait que
        // relayer l'erreur.
        console.warn('Forbidden (403) - Redirecting to access denied page...');
      }
      return throwError(() => error);
    }),
  );
};
