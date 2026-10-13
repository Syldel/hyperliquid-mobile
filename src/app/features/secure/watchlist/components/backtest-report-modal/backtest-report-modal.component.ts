import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import type { BacktestReport, BacktestStats, PositionSide } from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import { locateOutline } from 'ionicons/icons';
import { POSITION_COLORS } from '../../services/strategy-positions-pane.service';
import {
  backtestLimits,
  drawdownWindow,
  type DrawdownWindow,
  equityLines,
  formatDuration,
  formatPercent,
  formatPriceForDisplay,
  percentTone,
  statsOf,
  underwaterWindow,
} from '../../utils/backtest-display.util';
import { EquityCurveComponent, type EquityCurveLine } from '../equity-curve/equity-curve.component';

/** Ce que la modale renvoie quand un trade est touché : la page recentre son chart dessus. */
export interface BacktestFocus {
  entryTime: number;
  exitTime: number | null;
}

interface StatsColumn {
  label: string;
  stats: BacktestStats;
}

/**
 * Une ligne du bloc « Deepest drawdown » : la profondeur que le tableau donne
 * déjà, et surtout ses bornes, que le tableau ne peut pas porter — trois dates
 * dans une cellule de 13 px sur un téléphone ne se lisent pas. `window` à `null`
 * est une information : la courbe n'est jamais passée sous son sommet.
 */
interface DrawdownRow {
  label: string;
  depthPercent: number;
  window: DrawdownWindow | null;
}

/**
 * Une ligne de « Still under water » : depuis quel sommet, et depuis combien de
 * temps. La profondeur n'y est pas — le tableau la donne déjà, colonne par
 * colonne, et deux chiffres identiques à deux endroits invitent à chercher une
 * différence qui n'existe pas.
 */
interface UnderwaterRow {
  label: string;
  window: DrawdownWindow;
}

const SIDE_LABELS: Record<PositionSide, string> = { LONG: 'Long', SHORT: 'Short' };

/**
 * Le gris de la référence, posé en clair plutôt que lu d'une variable CSS : la
 * courbe vit dans un canvas que `lightweight-charts` peint lui-même, hors de la
 * cascade.
 *
 * Choisi pour tenir sur les deux fonds de la modale — calculé le 2026-10-14 :
 * **4,88:1** sur le sombre (#1d1d1d) et **3,45:1** sur le clair (#feffff), au
 * -dessus des 3:1 que la WCAG demande à un objet graphique. Les gris plus clairs
 * passent mieux en sombre et moins bien en clair (`#909090` : 5,28 et 3,19) :
 * c'est le thème clair qui contraint ici.
 */
const HOLD_COLOR = '#8a8a8a';

/** Le même nom dans la légende, le tableau et les deux blocs de drawdown. */
const HOLD_LABEL = 'Buy and hold';

/**
 * Le rapport de backtest d'une stratégie, en détail : chiffres par côté,
 * courbe, positions et liste des trades.
 *
 * N'affiche que ce que le bot a calculé (`BacktestReport`). Toucher un trade
 * referme la modale avec le rôle `focus` : la page recentre le chart principal
 * sur ce trade, là où ses bougies, ses marqueurs et sa bande de position se
 * lisent ensemble.
 */
@Component({
  selector: 'app-backtest-report-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonIcon,
    IonText,
    EquityCurveComponent,
  ],
  templateUrl: './backtest-report-modal.component.html',
  styleUrls: ['./backtest-report-modal.component.scss'],
})
export class BacktestReportModalComponent implements OnInit {
  readonly name = input.required<string>();
  readonly color = input.required<string>();
  readonly report = input.required<BacktestReport>();
  /** Côtés que la stratégie évalue — voir `definedSides`. */
  readonly sides = input.required<readonly PositionSide[]>();
  /** Ouverture de la bougie encore en cours au moment du calcul, s'il y en avait une. */
  readonly formingOpenTime = input<number | null>(null);

  private readonly modalCtrl = inject(ModalController);

  readonly limits = computed(() => backtestLimits([this.report().feePerSide]));
  readonly formatPercent = formatPercent;
  readonly formatDuration = formatDuration;
  readonly formatPriceForDisplay = formatPriceForDisplay;
  readonly percentTone = percentTone;
  readonly sideLabel = (side: PositionSide) => SIDE_LABELS[side];
  readonly sideColor = (side: PositionSide) =>
    side === 'LONG' ? POSITION_COLORS.long : POSITION_COLORS.short;

  // Calculés une fois : une entrée de modale ne change pas de sa vie, et un
  // `computed` qui n'en dépendrait que d'elle ne se recalculerait jamais —
  // voir docs/conventions.md, « Une entrée de modale se lit, elle ne se suit pas ».
  readonly columns = signal<StatsColumn[]>([]);
  readonly curve = signal<EquityCurveLine[]>([]);
  readonly tradesNewestFirst = signal<BacktestReport['trades']>([]);
  readonly lastPointProvisional = signal(false);
  readonly drawdownRows = signal<DrawdownRow[]>([]);
  readonly underwaterRows = signal<UnderwaterRow[]>([]);

  constructor() {
    addIcons({ locateOutline });
  }

  ngOnInit(): void {
    const report = this.report();
    const sides = this.sides().length > 0 ? this.sides() : (['LONG', 'SHORT'] as const);

    const columns: StatsColumn[] = [
      ...sides.map((side) => ({ label: SIDE_LABELS[side], stats: statsOf(report, side) })),
      ...(report.total ? [{ label: 'Total', stats: report.total }] : []),
    ];
    this.columns.set(columns);

    // Le sommet peut être le début de la fenêtre et non une bougie : c'est
    // `report.from` qui le datera alors — voir `drawdownWindow`.
    // La référence a droit aux mêmes lignes que les côtés : comparer deux
    // rendements sans comparer deux risques flatte celui qui en a pris le plus.
    const hold = report.hold;

    this.drawdownRows.set([
      ...columns.map((column) => ({
        label: column.label,
        depthPercent: column.stats.maxDrawdown.depthPercent,
        window: drawdownWindow(column.stats.maxDrawdown, report.from),
      })),
      ...(hold
        ? [
            {
              label: HOLD_LABEL,
              depthPercent: hold.maxDrawdown.depthPercent,
              window: drawdownWindow(hold.maxDrawdown, report.from),
            },
          ]
        : []),
    ]);

    // Seules les colonnes encore sous leur sommet : lister « at its peak » pour
    // les autres ferait trois lignes là où l'absence suffit, et le bloc dit déjà
    // en une phrase quand il n'y a plus personne sous l'eau.
    this.underwaterRows.set(
      [
        ...columns.map((column) => ({
          label: column.label,
          current: column.stats.currentDrawdown,
        })),
        ...(hold ? [{ label: HOLD_LABEL, current: hold.currentDrawdown }] : []),
      ].flatMap(({ label, current }) => {
        const window = underwaterWindow(current, report.from, report.to);
        return window === null ? [] : [{ label, window }];
      }),
    );

    this.curve.set(
      equityLines(report, sides).map((line) => ({
        id: line.id,
        points: line.points,
        // `emphasis` décide du trait plein : la référence reste en pointillés,
        // même quand il n'y a pas de total pour lui voler la vedette.
        emphasis: line.id === 'total' || (report.total === null && line.id !== 'hold'),
        color:
          line.id === 'total'
            ? this.color()
            : line.id === 'hold'
              ? HOLD_COLOR
              : line.id === 'LONG'
                ? POSITION_COLORS.long
                : POSITION_COLORS.short,
      })),
    );

    this.tradesNewestFirst.set([...report.trades].reverse());

    const forming = this.formingOpenTime();
    this.lastPointProvisional.set(forming !== null && report.equity.at(-1)?.time === forming);
  }

  lineLabel(id: string): string {
    if (id === 'total') return 'Total';
    if (id === 'hold') return HOLD_LABEL;
    return SIDE_LABELS[id as PositionSide];
  }

  close(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  focus(position: BacktestFocus): void {
    const focus: BacktestFocus = { entryTime: position.entryTime, exitTime: position.exitTime };
    this.modalCtrl.dismiss(focus, 'focus');
  }
}
