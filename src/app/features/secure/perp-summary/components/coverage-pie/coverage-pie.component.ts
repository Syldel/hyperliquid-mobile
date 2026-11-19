import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Coverage, CoverSource } from '../../position-protection.util';

/**
 * ============================================================================
 * UN ROND DE 14 PX : LA PART DE LA POSITION QU'UN STOP-LOSS OU UN TAKE-PROFIT FERMERAIT
 *
 * Remplace les mots `PROTECTED` / `PARTIAL` / `UNPROTECTED` sur la carte d'une position (demandé
 * le 2026-11-17 : plus discret, à côté du badge LONG / SHORT). Vide, en part, ou plein.
 *
 * Les deux rôles ne se lisent pas pareil, et ne se colorent donc pas pareil :
 *
 * - **SL** : l'absence est une alerte. Vide rouge, part orange, plein vert ;
 * - **TP** : l'absence est un choix. Vide gris, part et plein verts.
 * - **inconnu** (ordres illisibles) : gris en pointillé, pour les deux — jamais un rouge ni un vert
 *   devinés.
 *
 * Depuis le 2026-11-18, une **pastille** posée en bas à droite dit qui a posé l'ordre : un robot pour le
 * bot, un escalier pour le trailing natif (un stop qui monte par paliers et ne redescend jamais), rien
 * pour un ordre manuel. Elle a son propre fond, de la couleur de la carte, et un fin contour : posée nue
 * sur un rond plein, l'icône disparaissait dans le disque (maquette du 2026-11-18). Le libellé SL / TP
 * n'est plus ici : la carte l'écrit une fois par côté, quand deux sources y ont chacune leur rond.
 *
 * Aucun pourcentage n'est écrit à côté d'une part (retiré le 2026-11-18, à la demande : la part et la
 * couleur suffisent sur la carte). Le chiffre exact reste dans l'`aria-label`. Un symbole graphique
 * doit tenir 3:1 sur son fond (docs/theming.md) : l'orange est une variable du thème,
 * `--app-coverage-partial`, plus foncée en clair.
 * ============================================================================
 */
@Component({
  selector: 'app-coverage-pie',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="pie"
      [class.pie--marked]="source() !== 'manual'"
      [attr.data-tone]="tone()"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <span class="pie__disc">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle
            class="pie__ring"
            cx="7"
            cy="7"
            r="5.5"
            [attr.stroke-dasharray]="tone() === 'unknown' ? '2 2' : null"
          />
          @if (fraction() >= 1) {
            <circle class="pie__fill" cx="7" cy="7" r="5.5" />
          } @else if (fraction() > 0) {
            <!-- Un trait aussi épais que son rayon dessine une part de disque, depuis midi. -->
            <circle
              class="pie__slice"
              cx="7"
              cy="7"
              r="2.75"
              transform="rotate(-90 7 7)"
              [attr.stroke-dasharray]="sliceDash()"
            />
          }
        </svg>
        @switch (source()) {
          @case ('bot') {
            <svg
              class="pie__mark"
              width="11"
              height="11"
              viewBox="-0.5 -0.5 11 11"
              aria-hidden="true"
            >
              <circle class="pie__mark-bg" cx="5" cy="5" r="5.1" />
              <line class="pie__mark-line" x1="5" y1="1.2" x2="5" y2="3" />
              <rect class="pie__mark-fg" x="1.8" y="3" width="6.4" height="5" rx="1.4" />
              <circle class="pie__mark-hole" cx="3.7" cy="5.5" r="0.75" />
              <circle class="pie__mark-hole" cx="6.3" cy="5.5" r="0.75" />
            </svg>
          }
          @case ('trailing') {
            <svg
              class="pie__mark"
              width="11"
              height="11"
              viewBox="-0.5 -0.5 11 11"
              aria-hidden="true"
            >
              <circle class="pie__mark-bg" cx="5" cy="5" r="5.1" />
              <path class="pie__mark-stairs" d="M2 7.8 H3.8 V6 H5.6 V4.2 H7.4 V2.4 H8.4" />
            </svg>
          }
        }
      </span>
    </span>
  `,
  styleUrls: ['./coverage-pie.component.scss'],
})
export class CoveragePieComponent {
  readonly kind = input.required<'SL' | 'TP'>();
  /** `null` : la couverture n'a pas pu être lue. */
  readonly coverage = input.required<Coverage | null>();
  readonly source = input<CoverSource>('manual');

  readonly fraction = computed((): number => {
    const c = this.coverage();
    if (c === null || c.state === 'none') return 0;
    return c.state === 'full' ? 1 : c.pct / 100;
  });

  readonly tone = computed((): 'alert' | 'partial' | 'covered' | 'absent' | 'unknown' => {
    const c = this.coverage();
    if (c === null) return 'unknown';
    if (c.state === 'full') return 'covered';
    if (c.state === 'partial') return this.kind() === 'SL' ? 'partial' : 'covered';
    return this.kind() === 'SL' ? 'alert' : 'absent';
  });

  /** La longueur de la part, sur le périmètre du cercle de rayon 2,75. */
  readonly sliceDash = computed(() => `${(this.fraction() * 2 * Math.PI * 2.75).toFixed(2)} 99`);

  readonly ariaLabel = computed(() => {
    const name = this.kind() === 'SL' ? 'Stop-loss' : 'Take-profit';
    const by =
      this.source() === 'bot'
        ? ' by the bot'
        : this.source() === 'trailing'
          ? ' (native trailing)'
          : '';
    const c = this.coverage();
    if (c === null) return `${name}: unknown`;
    if (c.state === 'none') return `${name}${by}: none`;
    return c.state === 'full'
      ? `${name}${by}: whole position`
      : `${name}${by}: ${c.pct}% of the position`;
  });
}
