import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonBadge } from '@ionic/angular/standalone';
import { HL_ORDER_TYPE } from '@syldel/hl-shared-types';

/**
 * ============================================================================
 * LE BADGE GRIS DU TYPE D'ORDRE, ET L'ESCALIER DU TRAILING
 *
 * Un trailing stop natif porte le même escalier que sa pastille sur le rond de protection de la
 * position (`coverage-pie`) : un stop qui monte par paliers et ne redescend jamais. Demandé le
 * 2026-11-18, pour qu'un trailing se reconnaisse d'un coup d'œil dans Open Orders et History.
 *
 * Le libellé reste libre (`Trailing` dans la liste ouverte, faute de place ; le type complet dans
 * l'historique) : c'est le **type** qui décide du glyphe, jamais le texte affiché.
 *
 * Même construction que `app-side-badge` : un `ion-badge` ordinaire, l'hôte effacé, et le glyphe hors
 * du flux du texte (`.badge-glyph`, `badge--glyph`, styles.scss), pour garder la hauteur et le
 * centrage de tous les badges.
 * ============================================================================
 */
@Component({
  selector: 'app-order-type-badge',
  standalone: true,
  imports: [IonBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-badge color="medium" [class.badge--glyph]="trailing()">
      @if (trailing()) {
        <svg
          class="badge-glyph badge-glyph--stairs"
          width="9"
          height="9"
          viewBox="0 0 7 7"
          role="img"
          aria-label="Trailing stop"
        >
          <!-- Trois marches, pas les quatre de la pastille du rond (11 px) : à 7 px, des marches de
               1,4 px se lisaient comme un trait oblique (vu à ×3 le 2026-11-18). Encre de y = 1,3 à
               5,7 avec le trait : centrée sur 3,5, le milieu du badge, comme ▲, ▼ et ■. -->
          <path d="M0.55 5.25 H2.3 V3.5 H4.05 V1.75 H6.45" />
        </svg>
      }
      {{ label() ?? orderType() }}
    </ion-badge>
  `,
  styles: `
    :host {
      display: contents;
    }

    /* 9 px, pas les 7 de ▲, ▼ et ■ : un trait fin pèse moins qu'un aplat, et à 7 px l'escalier se lisait
       petit à côté du texte (demandé le 2026-11-19). Il dépasse les capitales (8 px) d'un pixel, centré. */
    ion-badge.badge--glyph {
      --badge-glyph-size: 9px;
    }

    /* Un trait, pas un aplat : petit, un escalier plein se lit comme un triangle. Le trait est en unités
       du viewBox (7) : 0,95 × 9/7 ≈ 1,2 px affichés, l'épaisseur du trait à 7 px. */
    .badge-glyph--stairs {
      fill: none;
      stroke: currentColor;
      stroke-width: 0.95;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
  `,
})
export class OrderTypeBadgeComponent {
  /** Le type tel que l'exchange l'écrit (`orderType`). */
  readonly orderType = input.required<string>();
  /** Le texte du badge, quand il diffère du type. */
  readonly label = input<string>();

  readonly trailing = computed(() => this.orderType() === HL_ORDER_TYPE.trailingStopMarket);
}
