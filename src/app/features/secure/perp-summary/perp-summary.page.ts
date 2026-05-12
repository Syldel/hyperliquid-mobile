import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  IonItem,
  IonLabel,
  IonList,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { DexSelectorComponent } from '@shared/components/dex-selector/dex-selector.component';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLClearinghouseState, HLPerpPositionDetail } from '@syldel/hl-shared-types';
import { forkJoin, Observable } from 'rxjs';
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
    DexSelectorComponent,
  ],
  templateUrl: './perp-summary.page.html',
  styleUrls: ['./perp-summary.page.scss'],
})
export class PerpSummaryPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly lifecycle = inject(AppLifecycleService);

  selectedDexNames = signal<string[]>([]);
  clearinghouseStates = signal<HLClearinghouseState[]>([]);
  activeSegment = signal<'positions' | 'account'>('positions');

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
    return (): Observable<HLClearinghouseState[]> => {
      const calls =
        dexs.length > 0
          ? dexs.map((dex) => this.hlInfo.getClearinghouseState(dex))
          : [this.hlInfo.getClearinghouseState()];
      return forkJoin(calls);
    };
  }

  clearinghouseState = computed(() => this.clearinghouseStates()[0]);

  positions = computed((): HLPerpPositionDetail[] =>
    this.clearinghouseStates()
      .flatMap((state) => state.assetPositions)
      .filter((ap) => ap.position !== null)
      .map((ap) => ap.position!),
  );

  onSelectionChanged(dexNames: string[]) {
    this.selectedDexNames.set(dexNames);
    this.fetchFn.set(this.buildFetchFn());
  }

  openWatchlist(coin: string): void {
    this.router.navigate(['/secure/watchlist/detail', coin], {
      state: { backHref: '/secure/perp-summary' },
    });
  }
}
