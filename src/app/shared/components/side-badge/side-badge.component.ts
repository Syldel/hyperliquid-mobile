import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonBadge } from '@ionic/angular/standalone';
import type { SideBadge } from '@utils/order-labels.util';

/**
 * ============================================================================
 * LE BADGE DE CÔTÉ : LONG / SHORT (BUY / SELL sur un spot), LE CÔTÉ DE L'API
 *
 * Un `ion-badge` **ordinaire**, à la même mise en page que `Limit` ou `ALO` : le style global
 * (`styles.scss`) rogne sa boîte de ligne sur les capitales, d'où 18 px de haut et un texte centré.
 * Le mot et sa couleur viennent de `order-labels.util.ts`.
 *
 * Plus de glyphe depuis le 2026-11-20 (▲ / ▼ ouvre, ■ ferme, du 2026-11-18 au 2026-11-19) : le badge
 * dit le côté de l'ordre tel que l'API l'écrit, et « Reduce only » dit qu'il ferme. Les classes
 * `badge--glyph` / `badge-glyph` restent dans `styles.scss` pour l'escalier du trailing
 * (`order-type-badge`).
 * ============================================================================
 */
@Component({
  selector: 'app-side-badge',
  standalone: true,
  imports: [IonBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-badge [color]="badge().tone">{{ badge().text }}</ion-badge>
  `,
  styles: `
    /* L'hôte s'efface : l'ion-badge prend place dans la ligne comme les autres badges. */
    :host {
      display: contents;
    }
  `,
})
export class SideBadgeComponent {
  readonly badge = input.required<SideBadge>();
}
