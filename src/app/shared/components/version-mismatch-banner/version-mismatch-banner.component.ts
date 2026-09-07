import { Component, computed, inject, signal } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import { addIcons } from 'ionicons';
import { closeOutline, warningOutline } from 'ionicons/icons';

/**
 * Bandeau signalant que ce build mobile et le bot n'exécutent pas la même
 * version de `@syldel/trading-shared-types` (catalogue indicateurs/transforms
 * /grammaire potentiellement désynchronisé — voir mobile-app-integration.md
 * dans nest-trading-bot pour l'incident qui a motivé ce garde-fou).
 *
 * Se place en pair d'un `<ion-router-outlet>` dans un shell monté une seule
 * fois (ex: `MenuComponent`), pour survivre à la navigation entre pages.
 * Fermer le bandeau ne le supprime que pour la session en cours : il
 * réapparaît au prochain lancement tant que la dérive persiste, pour ne
 * jamais devenir un avertissement qu'on apprend à ignorer.
 */
@Component({
  selector: 'app-version-mismatch-banner',
  standalone: true,
  imports: [IonIcon, IonButton],
  templateUrl: './version-mismatch-banner.component.html',
  styleUrls: ['./version-mismatch-banner.component.scss'],
})
export class VersionMismatchBannerComponent {
  private readonly botService = inject(BotService);

  private readonly dismissed = signal(false);

  readonly showWarning = computed(
    () => this.botService.hasPackageVersionMismatch() && !this.dismissed(),
  );
  readonly localPackageVersion = this.botService.localPackageVersion;
  readonly serverPackageVersion = this.botService.serverPackageVersion;

  constructor() {
    addIcons({ warningOutline, closeOutline });

    // Mise en cache 24h dans BotService : n'importe quel autre appelant de
    // getExchangeFormMetadata() réutilise la même réponse, ce n'est pas un
    // appel réseau supplémentaire.
    this.botService.getExchangeFormMetadata().subscribe();
  }

  dismiss(): void {
    this.dismissed.set(true);
  }
}
