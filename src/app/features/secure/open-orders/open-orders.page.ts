import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  IonBadge,
  IonFab,
  IonFabButton,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  ModalController,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { DexSelectorComponent } from '@shared/components/dex-selector/dex-selector.component';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLFrontendOpenOrder } from '@syldel/hl-shared-types';
import { isSpotMarket, openOrdersDexOf } from '@utils/market-kind.util';
import { addIcons } from 'ionicons';
import { addOutline, createOutline } from 'ionicons/icons';
import { forkJoin, map, Observable, of } from 'rxjs';
import { OrderFormComponent } from './open-form/order-form.component';
import { describeStuckTriggered, isStuckTriggeredOrder } from './stuck-triggered-order.util';

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
    IonIcon,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonFab,
    IonFabButton,
  ],
  templateUrl: './open-orders.page.html',
  styleUrls: ['./open-orders.page.scss'],
})
export class OpenOrdersPage extends MenuBasePage implements OnInit {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly lifecycle = inject(AppLifecycleService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly modalCtrl = inject(ModalController);

  /**
   * Un stop déclenché dont l'ordre est resté au carnet : la liste le disait nulle part (voir
   * `stuck-triggered-order.util.ts`).
   */
  readonly isStuckTriggered = isStuckTriggeredOrder;

  /** Ce qu'on en dit : entier, ou exécuté en partie (voir `describeStuckTriggered`). */
  readonly stuckTriggeredText = (order: HLFrontendOpenOrder) => describeStuckTriggered(order);

  openOrders = signal<HLFrontendOpenOrder[]>([]);
  selectedDexNames = signal<string[] | null>(null);
  coinFilter = signal<string>('');
  coinsResolved = signal(false);

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
    return (coin ? this.openOrders().filter((o) => o.coin === coin) : this.openOrders()).map(
      (o) => ({
        ...o,
        isSpot: isSpotMarket(o.coin),
      }),
    );
  });

  forcedDex = signal<string | null>(null);

  constructor() {
    super();
    addIcons({ createOutline, addOutline });
    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => {
        this.fetchFn.set(this.buildFetchFn());
      });
    });
  }

  override ionViewWillEnter(): void {
    super.ionViewWillEnter();
    this.fetchFn.set(this.buildFetchFn());
  }

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const raw = params.get('coin');
      if (raw) {
        const coin = this.normalizeCoin(raw);
        this.coinFilter.set(coin);
        // Le dex où se lisent les ordres de ce marché : le sien pour un perp, le dex principal pour un spot
        // (« Spot open orders are only included with the first perp dex »). Un nom que la règle ne classe
        // pas n'en a pas : on le dit, et aucun dex n'est forcé.
        const dex = openOrdersDexOf(coin);
        if (dex === null) {
          console.error(
            `[OpenOrdersPage] "${coin}" is not a market name this app can classify: no dex is forced.`,
          );
        }
        this.forcedDex.set(dex);
      } else {
        this.forcedDex.set(null);
      }
    });
  }

  private normalizeCoin(coin: string): string {
    const parts = coin.split(':');
    if (parts.length === 2) {
      return `${parts[0]}:${parts[1].toUpperCase()}`;
    }
    return coin.toUpperCase();
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

  onDataLoaded(orders: HLFrontendOpenOrder[]): void {
    this.openOrders.set(orders);
    this.coinsResolved.set(false);
    this.resolveAllCoins(orders);
  }

  private resolveAllCoins(orders: HLFrontendOpenOrder[]): void {
    const coins = orders.map((o) => o.coin);
    this.hlMarket.resolveCoins(coins).subscribe(() => {
      this.coinsResolved.set(true);
    });
  }

  displayCoin(coin: string): string {
    return this.hlMarket.displayCoin(coin);
  }

  onSelectionChanged(dexNames: string[]) {
    this.selectedDexNames.set(dexNames);
    if (this.forcedDex() === null) {
      this.coinFilter.set('');
    }
    this.fetchFn.set(this.buildFetchFn());
  }

  openOrderDetail(order: HLFrontendOpenOrder): void {
    this.router.navigate(['/secure/open-orders/detail'], {
      queryParams: { oid: order.oid, coin: order.coin },
      state: { order },
    });
  }

  openWatchlist(event: Event, coin: string): void {
    event.stopPropagation();
    this.router.navigate(['/secure/watchlist/detail', coin], {
      state: { backHref: '/secure/open-orders' },
    });
  }

  /** Ouvre le modal de création d'un nouvel ordre */
  async openAddModal(): Promise<void> {
    const defaultCoin = this.coinFilter() || '';
    const modal = await this.modalCtrl.create({
      component: OrderFormComponent,
      componentProps: {
        existingOrder: null,
        defaultCoin,
      },
    });
    await modal.present();
    const { role } = await modal.onWillDismiss();
    if (role === 'confirm') {
      this.fetchFn.set(this.buildFetchFn());
    }
  }
}
