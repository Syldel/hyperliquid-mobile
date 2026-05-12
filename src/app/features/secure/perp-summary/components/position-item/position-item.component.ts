import { PercentPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonText,
} from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { HLPerpPositionDetail } from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import { pulseOutline } from 'ionicons/icons';

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

  constructor() {
    addIcons({ pulseOutline });
  }

  toggle() {
    this.expanded.set(!this.expanded());
  }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    this.clicked.emit(this.position().coin);
  }
}
