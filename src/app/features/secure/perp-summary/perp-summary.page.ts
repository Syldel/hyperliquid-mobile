import { Component, computed, inject, signal } from '@angular/core';
import {
  IonItem,
  IonLabel,
  IonList,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLClearinghouseState, HLPerpPositionDetail } from '@syldel/hl-shared-types';
import { MarginSummaryComponent } from './components/margin-summary/margin-summary.component';
import { PositionItemComponent } from './components/position-item/position-item.component';

@Component({
  selector: 'app-perp-summary',
  standalone: true,
  imports: [
    RefreshableLayoutComponent,
    MarginSummaryComponent,
    PositionItemComponent,
    IonList,
    IonItem,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    SmartDecimalPipe,
  ],
  templateUrl: './perp-summary.page.html',
  styleUrls: ['./perp-summary.page.scss'],
})
export class PerpSummaryPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);

  clearinghouseState = signal<HLClearinghouseState | undefined>(undefined);
  fetchFn = () => this.hlInfo.getClearinghouseState();

  activeSegment = signal<'positions' | 'account'>('positions');

  positions = computed(
    (): HLPerpPositionDetail[] =>
      this.clearinghouseState()
        ?.assetPositions.filter((ap) => ap.position !== null)
        .map((ap) => ap.position!) ?? [],
  );
}
