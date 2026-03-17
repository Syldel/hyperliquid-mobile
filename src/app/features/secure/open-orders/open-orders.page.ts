import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { IonBadge, IonItem, IonLabel, IonList } from '@ionic/angular/standalone';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLFrontendOpenOrder } from '@syldel/hl-shared-types';

@Component({
  selector: 'app-open-orders',
  standalone: true,
  imports: [RefreshableLayoutComponent, IonList, IonItem, IonLabel, IonBadge, DatePipe],
  templateUrl: './open-orders.page.html',
  styleUrls: ['./open-orders.page.scss'],
})
export class OpenOrdersPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);

  openOrders = signal<HLFrontendOpenOrder[]>([]);
  fetchFn = () => this.hlInfo.getFrontendOpenOrders();
}
