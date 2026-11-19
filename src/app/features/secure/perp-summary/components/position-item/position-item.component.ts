import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { IonButton, IonItem, IonLabel, IonText, ModalController } from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { MiniChartComponent } from '@shared/components/mini-chart/mini-chart.component';
import { HLPerpPositionDetail } from '@syldel/hl-shared-types';
import { ClosePositionComponent } from '../../../open-orders/market-order/close-position.component';
import { TrailingStopFormComponent } from '../../../open-orders/trailing-stop-form/trailing-stop-form.component';
import { positionSideBadge } from '@utils/order-labels.util';
import { SideBadgeComponent } from '@shared/components/side-badge/side-badge.component';
import {
  OrderFormComponent,
  type ClosePreset,
} from '../../../open-orders/open-form/order-form.component';
import type { PositionProtection, SourceCoverage } from '../../position-protection.util';
import { CoveragePieComponent } from '../coverage-pie/coverage-pie.component';

@Component({
  selector: 'app-position-item',
  standalone: true,
  imports: [
    SideBadgeComponent,
    IonItem,
    IonLabel,
    IonText,
    IonButton,
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
  /** La paire est au bot ; `null` : profil illisible. Passé au formulaire Trail. */
  botManaged = input<boolean | null>(false);

  /**
   * Un rond par source, de chaque côté ; `null` : les ordres n'ont pas pu être lus, et le rond le dit en
   * gris pointillé. La carte n'en montre pas davantage (2026-11-18) : la raison d'un rond rouge et les
   * niveaux se lisent dans Open Orders et sur le chart.
   */
  readonly sl = computed((): SourceCoverage[] | null => {
    const p = this.protection();
    return p.verdict === 'read' ? p.sl : null;
  });
  readonly tp = computed((): SourceCoverage[] | null => {
    const p = this.protection();
    return p.verdict === 'read' ? p.tp : null;
  });

  readonly clicked = output<string>();
  /** Une action a peut-être changé la position : la page relit le compte. */
  readonly changed = output<void>();

  isLong = () => parseFloat(this.position().szi) > 0;
  sideBadge = computed(() => positionSideBadge(this.position().coin, this.isLong()));

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

  /**
   * « Trail » : un trailing stop natif qui ferme la position, en plus de son stop (étape 3 du chantier,
   * `docs/roadmap.md`).
   */
  async trail(event: Event): Promise<void> {
    event.stopPropagation();
    const position = this.position();
    const botManaged = this.botManaged();
    const modal = await this.modalCtrl.create({
      component: TrailingStopFormComponent,
      componentProps: { position: () => position, botManaged: () => botManaged },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
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
