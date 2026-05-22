import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { IonBadge, IonItem, IonLabel, IonText } from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { MiniChartComponent } from '@shared/components/mini-chart/mini-chart.component';
import { HLPerpPositionDetail } from '@syldel/hl-shared-types';

@Component({
  selector: 'app-position-item',
  standalone: true,
  imports: [
    IonItem,
    IonLabel,
    IonBadge,
    IonText,
    MiniChartComponent,
    DecimalPipe,
    SmartDecimalPipe,
    PercentPipe,
  ],
  templateUrl: './position-item.component.html',
  styleUrls: ['./position-item.component.scss'],
})
export class PositionItemComponent {
  position = input.required<HLPerpPositionDetail>();

  readonly clicked = output<string>();

  isLong = () => parseFloat(this.position().szi) > 0;

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

  fundingDisplay(value: string): string {
    const n = +value;
    const abs = Math.abs(n).toFixed(2);
    return n >= 0 ? `-${abs}` : `${abs}`;
  }
}
