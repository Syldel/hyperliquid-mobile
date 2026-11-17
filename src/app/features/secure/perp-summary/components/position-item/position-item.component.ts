import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonPopover,
  IonText,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { informationCircleOutline } from 'ionicons/icons';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { MiniChartComponent } from '@shared/components/mini-chart/mini-chart.component';
import { HLPerpPositionDetail } from '@syldel/hl-shared-types';
import { ClosePositionComponent } from '../../../open-orders/market-order/close-position.component';
import { sideBadgeLabel } from '@utils/order-labels.util';
import {
  OrderFormComponent,
  type ClosePreset,
} from '../../../open-orders/open-form/order-form.component';
import type { Coverage, PositionProtection, ProtectionNote } from '../../position-protection.util';
import { CoveragePieComponent } from '../coverage-pie/coverage-pie.component';

@Component({
  selector: 'app-position-item',
  standalone: true,
  imports: [
    IonItem,
    IonLabel,
    IonBadge,
    IonText,
    IonButton,
    IonIcon,
    IonPopover,
    CoveragePieComponent,
    MiniChartComponent,
    DecimalPipe,
    SmartDecimalPipe,
    PercentPipe,
  ],
  templateUrl: './position-item.component.html',
  styleUrls: ['./position-item.component.scss'],
})
export class PositionItemComponent {
  private readonly modalCtrl = inject(ModalController);

  position = input.required<HLPerpPositionDetail>();
  /** Ce que le carnet dit de sa protection, lu par la page (`position-protection.util.ts`). */
  protection = input.required<PositionProtection>();

  /** Les paires que le bot gère, lues dans le profil ; `null` si le profil n'a pas pu être lu. */
  botManaged = input.required<boolean | null>();

  constructor() {
    addIcons({ informationCircleOutline });
  }

  /** `null` : les ordres n'ont pas pu être lus — le rond le dit, en gris pointillé. */
  readonly sl = computed((): Coverage | null => {
    const p = this.protection();
    return p.verdict === 'read' ? p.sl : null;
  });
  readonly tp = computed((): Coverage | null => {
    const p = this.protection();
    return p.verdict === 'read' ? p.tp : null;
  });

  /**
   * Ce que la bulle ⓘ explique. La carte n'en montre que l'icône : une phrase y prenait deux lignes
   * à 360 px (vu le 2026-11-17). Sans note, pas d'icône.
   */
  readonly notes = computed((): ProtectionNote[] => {
    const p = this.protection();
    const notes = p.verdict === 'read' ? [...p.notes] : [{ text: p.reason, alters: true }];
    if (this.botManaged() === null) notes.push({ text: 'Bot pairs unreadable', alters: false });
    return notes;
  });
  /** Une note change la lecture (un stop déclenché qui ne protège plus) : l'icône prend l'orange. */
  readonly notesAlter = computed(() => this.notes().some((n) => n.alters));

  /**
   * Les niveaux, dans le bloc déplié : le stop et le take-profit les plus proches du prix, pour
   * comparer les positions d'un coup d'œil. `+1` : un autre ordre couvre aussi.
   */
  readonly levels = computed((): string | null => {
    const parts = [levelOf(this.sl()), levelOf(this.tp())].filter((l): l is string => l !== null);
    return parts.length > 0 ? parts.join(' · ') : null;
  });

  readonly infoOpen = signal(false);
  readonly infoEvent = signal<Event | null>(null);

  openInfo(event: Event): void {
    event.stopPropagation();
    this.infoEvent.set(event);
    this.infoOpen.set(true);
  }

  readonly clicked = output<string>();
  /** Une action a peut-être changé la position : la page relit le compte. */
  readonly changed = output<void>();

  isLong = () => parseFloat(this.position().szi) > 0;
  sideLabel = () => sideBadgeLabel(this.position().coin, this.isLong());

  pnlColor = computed(() => {
    const pnl = parseFloat(this.position().unrealizedPnl);
    if (pnl > 0) return 'success';
    if (pnl < 0) return 'danger';
    return 'medium';
  });

  expanded = signal<boolean>(false);

  toggle() {
    this.expanded.set(!this.expanded());
  }

  onClick(): void {
    this.clicked.emit(this.position().coin);
  }

  /** « Close market » : une part de la position, au marché, après confirmation. */
  async closeMarket(event: Event): Promise<void> {
    event.stopPropagation();
    const position = this.position();
    const modal = await this.modalCtrl.create({
      component: ClosePositionComponent,
      componentProps: { position: () => position },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'confirm') this.changed.emit();
  }

  /**
   * « Close limit » : le formulaire d'ordre, prérempli en reduce-only, du côté de clôture, à la
   * taille de la position. Le prix limite reste à choisir (le marché le pré-remplit).
   */
  async closeLimit(event: Event): Promise<void> {
    event.stopPropagation();
    const position = this.position();
    const preset: ClosePreset = {
      coin: position.coin,
      isBuy: !this.isLong(),
      sz: String(Math.abs(Number(position.szi))),
    };
    const modal = await this.modalCtrl.create({
      component: OrderFormComponent,
      componentProps: { existingOrder: null, defaultCoin: position.coin, closePreset: preset },
    });
    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'confirm') this.changed.emit();
  }

  fundingDisplay(value: string): string {
    const n = +value;
    const abs = Math.abs(n).toFixed(2);
    return n >= 0 ? `-${abs}` : `${abs}`;
  }
}

/** `SL 1788.6 +1` ; un TP/SL de position garde son rôle, un trailing s'écrit `TS`. */
function levelOf(coverage: Coverage | null): string | null {
  if (coverage === null || coverage.state === 'none') return null;
  const { kind, px } = coverage.nearest;
  const label = kind.replace('Position ', '');
  const more = coverage.covers.length > 1 ? ` +${coverage.covers.length - 1}` : '';
  return `${label} ${px}${more}`;
}
