import { Component, computed, inject } from '@angular/core';
import { IonBadge, IonItem, IonLabel } from '@ionic/angular/standalone';
import { AgentStatusService } from '@services/agent-status.service';
import { agentExpirySummary, formatLikeDashboard } from '@utils/agent-expiry.util';
import { formatEthereumAddress } from '@utils/ethereum-utils';

/**
 * L'agent (API wallet Hyperliquid) qui signe les ordres : son nom, son adresse
 * et son expiration, écrite comme la colonne « Valid Until » de la page API
 * de Hyperliquid pour s'y comparer d'un coup d'œil.
 *
 * Le badge reprend les paliers d'`agentExpiryStatus` ; le texte coloré passe
 * par des classes (`warning-shade`, `danger`), pas par `color="warning"`, dont
 * le jaune de base ne tient pas le contraste sur le fond de page.
 */
@Component({
  selector: 'app-agent-wallet',
  standalone: true,
  imports: [IonItem, IonLabel, IonBadge],
  templateUrl: './agent-wallet.component.html',
  styleUrl: './agent-wallet.component.scss',
})
export class AgentWalletComponent {
  readonly status = inject(AgentStatusService).status;

  readonly validUntilLabel = computed(() => {
    const status = this.status();
    return status.kind === 'valid' || status.kind === 'expired'
      ? formatLikeDashboard(status.validUntil)
      : null;
  });

  readonly summary = computed(() => agentExpirySummary(this.status()));

  /**
   * Abrégée comme sur l'écran de connexion (`wallet-item`, 12 + 12) : entière,
   * elle prenait deux lignes à 360 px. Les deux bouts suffisent à la comparer
   * à la page API ; l'adresse entière reste dans `title`.
   */
  readonly shortAddress = computed(() => {
    const status = this.status();
    return status.kind === 'valid' || status.kind === 'expired'
      ? formatEthereumAddress(status.agent.address, 12, 12)
      : null;
  });

  /** Un badge plein : noir sur jaune ou rouge, lisible dans les deux thèmes. */
  readonly badge = computed(() => {
    const status = this.status();
    switch (status.kind) {
      case 'loading':
        return null;
      case 'valid':
        return {
          color: status.level === 'ok' ? 'success' : status.level,
          label: status.remaining,
        };
      case 'expired':
        return { color: 'danger', label: 'Expired' };
      case 'missing':
        return { color: 'danger', label: 'Unknown' };
      case 'unavailable':
        return { color: 'warning', label: 'Unavailable' };
    }
  });
}
