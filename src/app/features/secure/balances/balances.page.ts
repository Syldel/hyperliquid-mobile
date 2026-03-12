import { Component, inject, signal } from '@angular/core';
import { IonItem, IonLabel, IonList, IonNote } from '@ionic/angular/standalone';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLSpotBalance } from '@syldel/hl-shared-types';

@Component({
  selector: 'app-balances',
  standalone: true,
  imports: [RefreshableLayoutComponent, IonList, IonItem, IonLabel, IonNote],
  templateUrl: './balances.page.html',
})
export class BalancesPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);

  balances = signal<HLSpotBalance[]>([]);
  fetchFn = () => this.hlInfo.getTokenBalances();
}
