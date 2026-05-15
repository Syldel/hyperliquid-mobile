import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { IonBadge, IonItem, IonLabel, IonList, IonNote } from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLOrderStatusData } from '@syldel/hl-shared-types';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [RefreshableLayoutComponent, IonList, IonItem, IonLabel, IonBadge, IonNote, DatePipe],
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
})
export class HistoryPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly lifecycle = inject(AppLifecycleService);

  historicalOrders = signal<HLOrderStatusData[]>([]);

  fetchFn = signal(this.buildFetchFn());

  constructor() {
    super();
    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => {
        this.fetchFn.set(this.buildFetchFn());
      });
    });
  }

  private buildFetchFn() {
    return (): Observable<HLOrderStatusData[]> => {
      return this.hlInfo.getHistoricalOrders();
    };
  }

  statusColor(status: HLOrderStatusData['status']): string {
    switch (status) {
      case 'filled':
        return 'success';
      case 'open':
        return 'primary';
      case 'canceled':
        return 'medium';
      case 'triggered':
        return 'tertiary';
      case 'rejected':
        return 'danger';
      case 'marginCanceled':
        return 'warning';
      default:
        return 'medium';
    }
  }
}
