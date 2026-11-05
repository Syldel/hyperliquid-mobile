import { Component, computed, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { AgentStatusService } from '@services/agent-status.service';
import { agentExpirySummary } from '@utils/agent-expiry.util';
import { addIcons } from 'ionicons';
import { alertCircleOutline, warningOutline } from 'ionicons/icons';

/**
 * Une ligne, dans le flux de la vue, sous le seuil d'alerte de l'agent :
 * orange à 14 jours, rouge à 3 jours, rouge aussi expiré ou inconnu.
 * Rien au-dessus du seuil, ni avant que l'agent soit lu.
 *
 * Placée dans les vues qui **signent** (formulaire d'ordre, détail d'un ordre,
 * Bot Strategies et sa modale de paire), pas dans le shell : ces écrans
 * s'ouvrent souvent en modale, au-dessus de tout bandeau du shell, et un
 * bandeau fixe aurait pu recouvrir un bouton d'envoi. Dans le flux, elle
 * pousse le contenu au lieu de le masquer (choix du 2026-11-05 : discret).
 *
 * Couleurs de texte : `warning-shade` et `danger`, jamais `color="warning"`
 * d'Ionic, dont le jaune de base tombe à 1,59:1 (docs/theming.md).
 */
@Component({
  selector: 'app-agent-expiry-notice',
  standalone: true,
  imports: [IonIcon],
  template: `
    @if (visible()) {
      <div
        class="agent-expiry-notice"
        [class.agent-expiry-notice--danger]="level() === 'danger'"
        [attr.role]="level() === 'danger' ? 'alert' : 'status'"
      >
        <ion-icon
          aria-hidden="true"
          [name]="level() === 'danger' ? 'alert-circle-outline' : 'warning-outline'"
        ></ion-icon>
        <span>{{ summary() }}</span>
      </div>
    }
  `,
  styleUrl: './agent-expiry-notice.component.scss',
})
export class AgentExpiryNoticeComponent {
  private readonly agentStatus = inject(AgentStatusService);

  private readonly status = this.agentStatus.status;

  readonly level = computed(() => {
    const status = this.status();
    return status.kind === 'loading' ? null : status.level;
  });
  readonly visible = computed(() => this.level() === 'warning' || this.level() === 'danger');
  readonly summary = computed(() => agentExpirySummary(this.status()));

  constructor() {
    addIcons({ warningOutline, alertCircleOutline });
  }
}
