import { computed, inject, Injectable, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '@auth/auth.service';
import { agentExpiryStatus, AgentExpiryStatus } from '@utils/agent-expiry.util';
import { firstValueFrom, interval } from 'rxjs';
import { AppLifecycleService } from './app-lifecycle.service';
import { UserService } from './user.service';

/**
 * L'agent (API wallet Hyperliquid) du wallet connecté et son expiration,
 * lus dans `/auth/me`.
 *
 * **Quand c'est lu** : à chaque fois qu'un wallet devient connecté — une
 * connexion, la restauration de session au démarrage, un changement de
 * wallet. Pas au retour au premier plan (décidé avec l'utilisateur le
 * 2026-11-05) : la date ne change que par `set-agent-key`, et un appel de
 * plus n'apprendrait rien. Après une rotation, la nouvelle date arrive au
 * prochain démarrage ou à la prochaine connexion.
 *
 * **Ce qui se recalcule sans réseau** : les jours restants et le palier de
 * couleur, chaque minute et au retour au premier plan, depuis la date déjà
 * lue — une app restée ouverte en arrière-plan passe au rouge le bon jour.
 */
@Injectable({ providedIn: 'root' })
export class AgentStatusService {
  private readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly lifecycle = inject(AppLifecycleService);

  private readonly minuteTick = toSignal(interval(60_000));

  /** Lecture seule : un `resource()` ne porte jamais d'écriture (voir docs/angular.md). */
  private readonly me = resource({
    // `undefined` tant qu'aucun wallet n'est connecté : le resource reste au
    // repos, et rien ne part sans jeton.
    params: computed(() =>
      this.auth.isLoggedIn() ? (this.auth.currentAddress() ?? undefined) : undefined,
    ),
    loader: () => firstValueFrom(this.userService.getMe()),
  });

  /**
   * L'état affiché. `loading` hors connexion aussi : sans wallet connecté il
   * n'y a rien à affirmer, et les vues qui signent demandent de toute façon
   * de se connecter.
   */
  readonly status = computed<AgentExpiryStatus>(() => {
    this.minuteTick();
    this.lifecycle.foregroundCount();
    if (!this.auth.isLoggedIn()) return { kind: 'loading' };

    const failed = this.me.status() === 'error';
    // `value()` lève quand le resource est en erreur : ne le lire qu'après.
    const user = failed ? undefined : this.me.value();
    const agent = user === undefined ? undefined : (user.agent ?? null);
    return agentExpiryStatus(agent, failed, Date.now());
  });
}
