import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Coverage } from '../../position-protection.util';

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
 * Le pourcentage s'écrit à côté quand la couverture est partielle : un camembert de 14 px ne se lit
 * pas à 10 % près. Un symbole graphique doit tenir 3:1 sur son fond (docs/theming.md) : l'orange
 * est une variable du thème, `--app-coverage-partial`, plus foncée en clair.
 * ============================================================================
 */
@Component({
  selector: 'app-coverage-pie',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pie" [attr.data-tone]="tone()" role="img" [attr.aria-label]="ariaLabel()">
      <span class="pie__label" aria-hidden="true">{{ kind() }}</span>
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
      @if (coverage(); as c) {
        @if (c.state === 'partial') {
          <span class="pie__pct" aria-hidden="true">{{ c.pct }}%</span>
        }
      }
    </span>
  `,
  styleUrls: ['./coverage-pie.component.scss'],
})
export class CoveragePieComponent {
  readonly kind = input.required<'SL' | 'TP'>();
  /** `null` : la couverture n'a pas pu être lue. */
  readonly coverage = input.required<Coverage | null>();

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
    const c = this.coverage();
    if (c === null) return `${name}: unknown`;
    if (c.state === 'none') return `${name}: none`;
    return c.state === 'full' ? `${name}: whole position` : `${name}: ${c.pct}% of the position`;
  });
}
