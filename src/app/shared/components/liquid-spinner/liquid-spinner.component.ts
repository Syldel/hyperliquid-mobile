import { Component } from '@angular/core';

@Component({
  selector: 'app-liquid-spinner',
  standalone: true,
  imports: [],
  templateUrl: './liquid-spinner.component.html',
  styleUrl: './liquid-spinner.component.scss',
})
export class LiquidSpinnerComponent {
  readonly uniqueId = `liquid-spinner-${Math.random().toString(36).substring(2, 11)}`;

  get filterId() {
    return `${this.uniqueId}-filter`;
  }

  get gradientId() {
    return `${this.uniqueId}-gradient`;
  }

  get linearGradientId() {
    return `${this.uniqueId}-linear-gradient`;
  }
}
