import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
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
  BACKTEST_LIMITS,
  equityLines,
  formatPercent,
  formatPriceForDisplay,
  percentTone,
  statsOf,
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

const SIDE_LABELS: Record<PositionSide, string> = { LONG: 'Long', SHORT: 'Short' };

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

  readonly limits = BACKTEST_LIMITS;
  readonly formatPercent = formatPercent;
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

  constructor() {
    addIcons({ locateOutline });
  }

  ngOnInit(): void {
    const report = this.report();
    const sides = this.sides().length > 0 ? this.sides() : (['LONG', 'SHORT'] as const);

    this.columns.set([
      ...sides.map((side) => ({ label: SIDE_LABELS[side], stats: statsOf(report, side) })),
      ...(report.total ? [{ label: 'Total', stats: report.total }] : []),
    ]);

    this.curve.set(
      equityLines(report, sides).map((line) => ({
        id: line.id,
        points: line.points,
        emphasis: line.id === 'total' || report.total === null,
        color:
          line.id === 'total'
            ? this.color()
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
    return id === 'total' ? 'Total' : SIDE_LABELS[id as PositionSide];
  }

  close(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  focus(position: BacktestFocus): void {
    const focus: BacktestFocus = { entryTime: position.entryTime, exitTime: position.exitTime };
    this.modalCtrl.dismiss(focus, 'focus');
  }
}
