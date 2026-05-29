import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  IonBadge,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { DexSelectorComponent } from '@shared/components/dex-selector/dex-selector.component';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { forkJoin, map, Observable, of } from 'rxjs';

@Component({
  selector: 'app-open-orders',
  standalone: true,
  imports: [
    RefreshableLayoutComponent,
    DexSelectorComponent,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    DatePipe,
    IonSelect,
    IonSelectOption,
  ],
  templateUrl: './open-orders.page.html',
  styleUrls: ['./open-orders.page.scss'],
})
export class OpenOrdersPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly lifecycle = inject(AppLifecycleService);

  openOrders = signal<HLFrontendOpenOrder[]>([]);
  selectedDexNames = signal<string[] | null>(null);
  coinFilter = signal<string>('');

  fetchFn = signal(this.buildFetchFn());

  availableCoins = computed(() => [...new Set(this.openOrders().map((o) => o.coin))].sort());

  coinCounts = computed(() => {
    const map = new Map<string, number>();
    for (const o of this.openOrders()) {
      map.set(o.coin, (map.get(o.coin) ?? 0) + 1);
    }
    return map;
  });

  filteredOrders = computed(() => {
    const coin = this.coinFilter();
    return coin ? this.openOrders().filter((o) => o.coin === coin) : this.openOrders();
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
    const dexs = this.selectedDexNames();
    if (dexs === null) return (): Observable<HLFrontendOpenOrder[]> => of([]);

    return (): Observable<HLFrontendOpenOrder[]> => {
      const calls =
        dexs.length > 0
          ? dexs.map((dex) => this.hlInfo.getFrontendOpenOrders(dex))
          : [this.hlInfo.getFrontendOpenOrders()];
      return forkJoin(calls).pipe(map((results) => results.flat()));
    };
  }

  onSelectionChanged(dexNames: string[]) {
    this.selectedDexNames.set(dexNames);
    this.coinFilter.set('');
    this.fetchFn.set(this.buildFetchFn());
  }

  openWatchlist(event: Event, coin: string): void {
    event.stopPropagation();
    this.router.navigate(['/secure/watchlist/detail', coin], {
      state: { backHref: '/secure/open-orders' },
    });
  }
}
