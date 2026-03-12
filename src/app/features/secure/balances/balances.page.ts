import { Component, inject } from '@angular/core';
import {
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
} from '@ionic/angular/standalone';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import {
  REFRESHABLE_PAGE_IMPORTS,
  RefreshablePage,
} from '@shared/components/base-page/refreshable-page';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { HLSpotBalance } from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import { walletOutline } from 'ionicons/icons';

@Component({
  selector: 'app-balances',
  standalone: true,
  imports: [
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonIcon,
    PageHeaderComponent,
    ...REFRESHABLE_PAGE_IMPORTS,
  ],
  templateUrl: './balances.page.html',
})
export class BalancesPage extends RefreshablePage<HLSpotBalance[]> {
  private readonly hlInfo = inject(HyperliquidInfoService);

  fetch = () => this.hlInfo.getTokenBalances();

  override async ngOnInit() {
    addIcons({ walletOutline });
    await super.ngOnInit();
  }
}
