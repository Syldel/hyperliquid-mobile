import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  IonBadge,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLOrderStatusData } from '@syldel/hl-shared-types';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [
    RefreshableLayoutComponent,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonNote,
    IonSelect,
    IonSelectOption,
    DatePipe,
  ],
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
})
export class HistoryPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly lifecycle = inject(AppLifecycleService);

  historicalOrders = signal<HLOrderStatusData[]>([]);
  coinFilter = signal<string>('');

  fetchFn = signal(this.buildFetchFn());

  availableCoins = computed(() =>
    [...new Set(this.historicalOrders().map((o) => o.order.coin))].sort(),
  );

  coinCounts = computed(() => {
    const map = new Map<string, number>();
    for (const o of this.historicalOrders()) {
      map.set(o.order.coin, (map.get(o.order.coin) ?? 0) + 1);
    }
    return map;
  });

  filteredOrders = computed(() => {
    const coin = this.coinFilter();
    return coin
      ? this.historicalOrders().filter((o) => o.order.coin === coin)
      : this.historicalOrders();
  });

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

  onDataLoaded(orders: HLOrderStatusData[]): void {
    this.historicalOrders.set(orders);
    this.resolveAllCoins(orders);
  }

  private resolveAllCoins(orders: HLOrderStatusData[]): void {
    const coins = orders.map((o) => o.order.coin);
    this.hlMarket.resolveCoins(coins).subscribe(() => {
      // force le re-render via un signal
      this.historicalOrders.set([...this.historicalOrders()]);
    });
  }

  displayCoin(coin: string): string {
    return this.hlMarket.displayCoin(coin);
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

  openWatchlist(event: Event, coin: string): void {
    event.stopPropagation();
    this.router.navigate(['/secure/watchlist/detail', coin], {
      state: { backHref: '/secure/history' },
    });
  }
}
