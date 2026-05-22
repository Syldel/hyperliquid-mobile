import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { IonBadge, IonItem, IonLabel, IonList } from '@ionic/angular/standalone';
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
  ],
  templateUrl: './open-orders.page.html',
  styleUrls: ['./open-orders.page.scss'],
})
export class OpenOrdersPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly lifecycle = inject(AppLifecycleService);

  openOrders = signal<HLFrontendOpenOrder[]>([]);
  selectedDexNames = signal<string[] | null>(null);

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
    this.fetchFn.set(this.buildFetchFn());
  }

  openWatchlist(event: Event, coin: string): void {
    event.stopPropagation();
    this.router.navigate(['/secure/watchlist/detail', coin], {
      state: { backHref: '/secure/open-orders' },
    });
  }
}
