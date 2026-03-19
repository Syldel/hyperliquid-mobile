import { Component, computed, input, signal } from '@angular/core';
import { IonBadge, IonItem, IonLabel, IonText } from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { HLPerpPositionDetail } from '@syldel/hl-shared-types';

@Component({
  selector: 'app-position-item',
  standalone: true,
  imports: [IonItem, IonLabel, IonBadge, IonText, SmartDecimalPipe],
  templateUrl: './position-item.component.html',
  styleUrls: ['./position-item.component.scss'],
})
export class PositionItemComponent {
  position = input.required<HLPerpPositionDetail>();

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
}
