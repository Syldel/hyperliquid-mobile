import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonBadge } from '@ionic/angular/standalone';
import { type SideBadge, sideBadgeGlyph } from '@utils/order-labels.util';

/**
 * ============================================================================
 * LE BADGE DE CÔTÉ : LONG / SHORT, ET UN GLYPHE PLEIN POUR L'ACTION
 *
 * ▲ ouvre un LONG (un achat), ▼ ouvre un SHORT (une vente), ■ ferme (`sideBadgeGlyph`). Le
 * glyphe remplace le mot `OPEN` / `CLOSE`, coupé à 360 px (2026-11-18). D'abord ▶ pour toute
 * ouverture ; ▲ / ▼ depuis le 2026-11-19, la convention des marqueurs d'achat et de vente de
 * TradingView, et déjà celle des exécutions sur le chart de la watchlist (`▲` achat, `▼` vente).
 * ⚠️ Les marqueurs de **stratégie** du chart (`strategy-markers.util.ts`) disent encore flèche haute
 * = entrée, flèche basse = sortie, quel que soit le côté : un ▼ y veut dire « sortie », ici « ouvre
 * un short ». Incohérence connue, ouverte mais pas prioritaire : l'alignement sur ces badges, essayé
 * le 2026-11-19, chargeait trop le chart (docs/roadmap.md).
 *
 * ■ reste un carré, sans direction : fermer un short est un achat, mais le badge parle de la
 * position (SHORT, rouge), pas de l'exécution.
 *
 * Le badge reste un `ion-badge` **ordinaire**, à la même mise en page que `Limit` ou `ALO`. Le style
 * global (`styles.scss`) y rogne la boîte de ligne sur les capitales (`text-box: trim-both cap
 * alphabetic`) : c'est ce qui fait 18 px de haut et centre le texte au padding près. Une première
 * version passait le badge en `flex` : le rognage ne s'appliquait plus, le badge montait à **21,2 px**
 * (vu sur le téléphone, 2026-11-18). Une deuxième posait le glyphe en ligne, relevé d'une fraction
 * d'em : juste dans le navigateur de développement, texte trop bas sur le téléphone.
 *
 * Le glyphe est donc **hors du flux** (`.badge-glyph` en absolu, `badge--glyph` élargit le padding
 * gauche, styles.scss) : la ligne du badge ne contient que son texte, comme avant les glyphes, et le
 * texte se centre par la seule règle commune à tous les badges.
 * ============================================================================
 */
@Component({
  selector: 'app-side-badge',
  standalone: true,
  imports: [IonBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-badge [color]="badge().tone" [class.badge--glyph]="glyph()">
      @switch (glyph()) {
        @case ('buy') {
          <svg
            class="badge-glyph"
            width="7"
            height="7"
            viewBox="0 0 7 7"
            role="img"
            aria-label="Opens, buys"
          >
            <!-- Encre de 7 × 6, centrée sur 3,5 comme ■. -->
            <path d="M0 6.5 L3.5 0.5 L7 6.5Z" />
          </svg>
        }
        @case ('sell') {
          <svg
            class="badge-glyph"
            width="7"
            height="7"
            viewBox="0 0 7 7"
            role="img"
            aria-label="Opens, sells"
          >
            <path d="M0 0.5 L7 0.5 L3.5 6.5Z" />
          </svg>
        }
        @case ('close') {
          <svg
            class="badge-glyph"
            width="7"
            height="7"
            viewBox="0 0 7 7"
            role="img"
            aria-label="Closes"
          >
            <!-- 6 px et non 7 : à taille égale, un carré plein pèse à l'œil bien plus qu'un triangle (49
                 contre 21 px² d'encre), et ■ paraissait plus gras que ▲ / ▼ (2026-11-19). Centré dans la
                 boîte de 7 : le texte garde sa place. -->
            <rect x="0.5" y="0.5" width="6" height="6" rx="0.95" />
          </svg>
        }
      }
      {{ badge().text }}
    </ion-badge>
  `,
  // Le glyphe et le badge portent les classes globales badge-glyph / badge--glyph (styles.scss),
  // communes avec l'escalier du trailing.
  styles: `
    /* L'hôte s'efface : l'ion-badge prend place dans la ligne comme les autres badges. */
    :host {
      display: contents;
    }
  `,
})
export class SideBadgeComponent {
  readonly badge = input.required<SideBadge>();

  /** ▲ / ▼ / ■, ou rien : la règle vit dans `sideBadgeGlyph`, testée. */
  readonly glyph = computed(() => sideBadgeGlyph(this.badge()));
}
