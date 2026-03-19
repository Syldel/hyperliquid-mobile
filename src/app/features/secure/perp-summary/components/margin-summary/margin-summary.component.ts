import { Component, input } from '@angular/core';
import { IonItem, IonLabel, IonListHeader } from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { HLPerpMarginSummary } from '@syldel/hl-shared-types';

@Component({
  selector: 'app-margin-summary',
  standalone: true,
  imports: [IonListHeader, IonItem, IonLabel, SmartDecimalPipe],
  templateUrl: './margin-summary.component.html',
  styleUrls: ['./margin-summary.component.scss'],
})
export class MarginSummaryComponent {
  summary = input.required<HLPerpMarginSummary>();
  title = input.required<string>();
}
