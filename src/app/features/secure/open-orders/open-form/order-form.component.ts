import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonToggle,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { AvailableCapitalService } from '@services/available-capital.service';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { MarketPickerModalComponent } from '@shared/components/market-picker-modal/market-picker-modal.component';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import {
  HlActiveAssetData,
  HlActiveAssetLeverage,
  HLFrontendOpenOrder,
  HLOrderDetails,
  HLPlaceOrderResponse,
  HLPlaceOrderStatus,
  HLSuccessResponse,
  HLTif,
} from '@syldel/hl-shared-types';
import { extractErrorMessage } from '@utils/hl-error.utils';
import { roundPrice, roundSize } from '@utils/hl-rounding.utils';
import {
  buildProtectiveOrderDetails,
  computeProtectiveTriggerPx,
} from '@utils/protective-order.utils';
import { addIcons } from 'ionicons';
import {
  addOutline,
  chevronForwardOutline,
  closeOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import { catchError, map, Observable, of, tap } from 'rxjs';
import {
  ProtectiveOrderFormComponent,
  ProtectiveOrderResult,
} from '../protective-order-form/protective-order-form.component';

export type OrderFormMode = 'place' | 'modify';

@Component({
  selector: 'app-order-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RefreshableLayoutComponent,
    FormsModule,
    IonButton,
    IonIcon,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonToggle,
    IonSpinner,
  ],
  templateUrl: './order-form.component.html',
  styleUrls: ['./order-form.component.scss'],
})
export class OrderFormComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly hlGateway = inject(HyperliquidGatewayService);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly toastCtrl = inject(ToastController);
  private readonly availableCapitalService = inject(AvailableCapitalService);

  existingOrder: HLFrontendOpenOrder | null = null;
  defaultCoin: string = '';

  mode = signal<OrderFormMode>('place');

  szDecimals = signal<number>(3);
  currentPrice = signal<number | null>(null);
  leverage = signal<HlActiveAssetLeverage | null>(null);
  maxLeverage = signal<number | null>(null);
  activePosition = signal<{ isBuy: boolean; sz: string; entryPx: string } | null>(null);

  protectiveOrders = signal<ProtectiveOrderResult[]>([]);
  showProtectiveSection = computed(() => this.orderKind() === 'limit' && !this.isModify());
  canAddProtectiveOrder = computed(() => !!this.limitPx() && parseFloat(this.sz()) > 0);

  priceDiffPct = computed(() => {
    const current = this.currentPrice();
    const limit = parseFloat(this.limitPx());
    if (!current || !limit || isNaN(limit)) return null;
    return ((limit - current) / current) * 100;
  });
  isPriceInvalid = computed(() => {
    const current = this.currentPrice();
    if (!current) return false;
    const isBuy = this.isBuy();

    if (this.orderKind() === 'trigger') {
      const trigger = parseFloat(this.triggerPx());
      if (!trigger) return false;
      const triggerPct = ((trigger - current) / current) * 100;
      return this.tpsl() === 'tp'
        ? isBuy
          ? triggerPct > 0
          : triggerPct < 0
        : isBuy
          ? triggerPct < 0
          : triggerPct > 0;
    }

    if (this.reduceOnly()) return false;

    const pct = this.priceDiffPct();
    if (pct === null) return false;
    return isBuy ? pct > 0 : pct < 0;
  });
  priceDiffClass = computed(() =>
    this.priceDiffPct() === null ? '' : this.isPriceInvalid() ? 'diff--danger' : '',
  );

  triggerDiffPct = computed(() => {
    const current = this.currentPrice();
    const trigger = parseFloat(this.triggerPx());
    if (!current || !trigger || isNaN(trigger)) return null;
    return ((trigger - current) / current) * 100;
  });

  triggerDiffClass = computed(() =>
    this.triggerDiffPct() === null ? '' : this.isPriceInvalid() ? 'diff--danger' : '',
  );

  sizeUsd = computed(() => {
    const sz = parseFloat(this.sz());
    const price = parseFloat(this.limitPx()) || this.currentPrice() || 0;
    if (!sz || isNaN(sz) || !price) return null;
    return sz * price;
  });
  isSizeInvalid = computed(() => {
    const usd = this.sizeUsd();
    return usd !== null && usd < 10;
  });
  sizeUsdClass = computed(() => (this.isSizeInvalid() ? 'diff--danger' : ''));

  isFormInvalid = computed(() => {
    const order = this.buildOrderDetails();
    if (!order.assetName || !order.limitPx || !order.sz) return true;
    if (parseFloat(order.sz) <= 0) return true;
    return this.isPriceInvalid() || this.isSizeInvalid();
  });

  isSpot = computed(() => this.selectedCoin()?.includes('/') || this.selectedCoin()?.includes('-'));

  // Champs du formulaire
  selectedCoin = signal('');
  isBuy = signal(true);
  limitPx = signal('');
  sz = signal('');
  reduceOnly = signal(false);
  tif = signal<HLTif>('Alo');
  orderKind = signal<'limit' | 'trigger'>('limit');
  triggerPx = signal('');
  isMarket = signal(true);
  tpsl = signal<'tp' | 'sl'>('sl');

  submitting = signal(false);
  error = signal<string | null>(null);

  coinTitle = signal('—');
  availableCapital = signal<number | null>(null);

  isModify = computed(() => this.mode() === 'modify');

  fetchFn = signal(this.buildFetchFn());

  previousKind = signal<'limit' | 'trigger'>(this.orderKind());
  readonly TRIGGER_OFFSET = 0.001; // 0.1%

  private defaultSizeApplied = false;

  private getTriggerFactor(): number {
    return this.isBuy() ? 1 + this.TRIGGER_OFFSET : 1 - this.TRIGGER_OFFSET;
  }

  private applyTriggerSlippage(triggerPx: number): number {
    return parseFloat(
      roundPrice(triggerPx * this.getTriggerFactor(), this.szDecimals(), this.isSpot()),
    );
  }

  private applyReverseTrigger(limitPx: number): number {
    return parseFloat(
      roundPrice(limitPx / this.getTriggerFactor(), this.szDecimals(), this.isSpot()),
    );
  }

  constructor() {
    addIcons({ closeOutline, chevronForwardOutline, addOutline, shieldCheckmarkOutline });

    effect(() => {
      const price = this.currentPrice();
      if (!price || this.isModify() || this.defaultSizeApplied) return;
      untracked(() => {
        this.sz.set((10 / price).toFixed(6));
        this.defaultSizeApplied = true;
      });
    });

    effect(() => {
      const coin = this.selectedCoin();
      untracked(() => {
        this.fetchFn.set(this.buildFetchFn());
        this.defaultSizeApplied = false;
        this.activePosition.set(null);
        if (!coin) return;
        if (this.isSpot()) {
          this.hlMarket.getSpotMeta().subscribe((meta) => {
            const market = meta.tokens.find((m) => m.name === coin || coin.includes(m.name));
            if (market) this.szDecimals.set(market.szDecimals);
          });
        } else {
          const dex = this.hlMarket.extractDex(coin);
          this.hlMarket.getPerpMeta(dex).subscribe((meta) => {
            const market = meta.universe.find((m) => m.name === coin || coin.includes(m.name));
            if (market) {
              this.szDecimals.set(market.szDecimals);
              this.maxLeverage.set(market.maxLeverage);
            }
          });
        }
        if (this.orderKind() === 'trigger') {
          this.loadActivePosition();
        }
      });
    });

    effect(() => {
      const kind = this.orderKind();
      const isBuy = this.isBuy();
      untracked(() => {
        if (this.isModify()) return;
        const kindChanged = kind !== this.previousKind();
        this.previousKind.set(kind);
        this.reduceOnly.set(kind === 'trigger');
        if (kindChanged) {
          this.isBuy.set(!isBuy);
          this.loadActivePosition();
        }
        if (kind !== 'trigger') {
          this.activePosition.set(null);
        }
        if (kind === 'trigger') {
          const limit = parseFloat(this.limitPx());
          if (limit) this.triggerPx.set(String(this.applyReverseTrigger(limit)));
        }
      });
    });

    effect(() => {
      const triggerPx = this.triggerPx();
      const isMarket = this.isMarket();
      const isBuy = this.isBuy();
      untracked(() => {
        if (this.orderKind() !== 'trigger') return;
        const trigger = parseFloat(triggerPx);
        if (!trigger) return;
        this.limitPx.set(String(this.applyTriggerSlippage(trigger)));
      });
    });
  }

  ngOnInit(): void {
    const existing = this.existingOrder;

    if (existing) {
      this.mode.set('modify');
      this.selectedCoin.set(existing.coin);
      this.isBuy.set(existing.side === 'B');
      this.limitPx.set(existing.limitPx);
      this.sz.set(existing.sz);
      this.reduceOnly.set(existing.reduceOnly);

      if (existing.isTrigger) {
        this.orderKind.set('trigger');
        this.triggerPx.set(existing.triggerPx ?? '');
        this.tpsl.set(existing.orderType.toLowerCase().includes('stop') ? 'sl' : 'tp');
        this.isMarket.set(existing.orderType.toLowerCase().includes('market'));
      } else {
        this.orderKind.set('limit');
        if (existing.tif && ['Alo', 'Ioc', 'Gtc'].includes(existing.tif)) {
          this.tif.set(existing.tif as HLTif);
        }
      }

      this.hlMarket.resolveCoin(existing.coin).subscribe((name) => this.coinTitle.set(name));
    } else {
      this.mode.set('place');
      const coin = this.defaultCoin;
      if (coin) {
        this.selectedCoin.set(coin);
        this.hlMarket.resolveCoin(coin).subscribe((name) => this.coinTitle.set(name));
      }
    }
  }

  private buildFetchFn() {
    const selectedCoin = this.selectedCoin();
    if (!selectedCoin) return () => of({ fake: true } as any);

    return () => {
      this.loadCapital(selectedCoin);
      return this.loadActiveAssetData(selectedCoin);
    };
  }

  onDataLoaded(data: HlActiveAssetData | null): void {
    if (!data) return;
    this.currentPrice.set(parseFloat(data.markPx));
    this.leverage.set(data.leverage);
  }

  private loadCapital(pairName: string): void {
    if (!pairName) {
      this.availableCapital.set(null);
      return;
    }
    const dex = this.hlMarket.extractDex(pairName);
    this.availableCapitalService.getAvailableCapital(dex, pairName).subscribe({
      next: (capital) => this.availableCapital.set(capital),
      error: () => this.availableCapital.set(null),
    });
  }

  private loadActiveAssetData(coin: string): Observable<HlActiveAssetData | null> {
    return this.hlInfo.getActiveAssetData(coin).pipe(
      catchError((err) => {
        console.error('loadActiveAssetData error', err);
        return of(null);
      }),
    );
  }

  private loadActivePosition(): void {
    const coin = this.selectedCoin();
    if (!coin || this.isModify() || this.orderKind() !== 'trigger') {
      this.activePosition.set(null);
      return;
    }

    const dex = this.hlMarket.extractDex(coin);
    this.hlInfo.getClearinghouseState(dex).subscribe({
      next: (state) => {
        const position = state.assetPositions.find((ap) => ap.position?.coin === coin)?.position;
        if (!position) {
          this.activePosition.set(null);
          return;
        }

        const szi = parseFloat(position.szi);
        if (!szi) {
          this.activePosition.set(null);
          return;
        }

        const sz = roundSize(Math.abs(szi), this.szDecimals());
        const isBuy = szi > 0; // szi > 0 = long, szi < 0 = short

        this.activePosition.set({ isBuy, sz, entryPx: position.entryPx });
        this.sz.set(sz);
        this.isBuy.set(!isBuy); // side de clôture: long -> sell, short -> buy
      },
      error: () => this.activePosition.set(null),
    });
  }

  async openMarketPicker(): Promise<void> {
    if (this.isModify()) return;

    const modal = await this.modalCtrl.create({
      component: MarketPickerModalComponent,
      componentProps: {
        initialValue: () => this.selectedCoin(),
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<string>();
    if (role === 'confirm' && data) {
      this.selectedCoin.set(data);
      this.hlMarket.resolveCoin(data).subscribe((name) => this.coinTitle.set(name));
    }
  }

  async openProtectiveOrderModal(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ProtectiveOrderFormComponent,
      componentProps: {
        coin: this.selectedCoin(),
        coinTitle: this.coinTitle(),
        mainIsBuy: this.isBuy(),
        mainLimitPx: this.limitPx(),
        mainSz: this.sz(),
        szDecimals: this.szDecimals(),
        isSpotAsset: this.isSpot(),
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<ProtectiveOrderResult>();
    if (role === 'confirm' && data) {
      this.protectiveOrders.update((list) => [...list, data]);
    }
  }

  removeProtectiveOrder(id: string): void {
    this.protectiveOrders.update((list) => list.filter((p) => p.id !== id));
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  getProtectiveTriggerPx(p: ProtectiveOrderResult): string {
    return computeProtectiveTriggerPx(
      {
        isBuy: this.isBuy(),
        limitPx: this.limitPx(),
        szDecimals: this.szDecimals(),
        isSpot: this.isSpot(),
      },
      { kind: p.kind, priceOffsetPercent: p.priceOffsetPercent },
    );
  }

  getProtectiveSize(p: ProtectiveOrderResult): string {
    const mainSz = parseFloat(this.sz()) || 0;
    return roundSize((mainSz * p.sizePercent) / 100, this.szDecimals());
  }

  private showOrderStatusToast(status: HLPlaceOrderStatus | undefined, label: string): void {
    if (!status) {
      this.presentToast(`${label}: no response`, 'danger');
      return;
    }
    if (status.error) {
      this.presentToast(`${label} failed: ${status.error}`, 'danger');
      return;
    }

    const oid = status.resting?.oid ?? status.filled?.oid;
    let message: string;
    if (status.filled) {
      const { totalSz, avgPx } = status.filled;
      message = oid
        ? `${label} filled · sz ${totalSz} @ ${avgPx} · OID ${oid}`
        : `${label} filled · sz ${totalSz} @ ${avgPx}`;
    } else {
      message = oid ? `${label} placed · OID ${oid}` : `${label} placed`;
    }

    this.presentToast(message, status.filled ? 'success' : 'primary');
  }

  private presentToast(message: string, color: string): void {
    this.toastCtrl
      .create({
        message,
        duration: 3000,
        position: 'top',
        color,
        buttons: [{ icon: 'close-outline', role: 'cancel' }],
      })
      .then((t) => t.present());
  }

  private submitProtectiveOrders$(mainContext: {
    assetName: string;
    isBuy: boolean;
    limitPx: string;
    sz: string;
    szDecimals: number;
    isSpot: boolean;
  }): Observable<void> {
    const items = this.protectiveOrders();
    if (items.length === 0) return of(undefined);

    const orders = items.map((p) => buildProtectiveOrderDetails(mainContext, p));
    const labels = items.map((p) => p.label);

    return this.hlGateway.placeOrders(orders).pipe(
      tap((res) => {
        const statuses: HLPlaceOrderStatus[] = res?.response?.data?.statuses ?? [];
        labels.forEach((label, i) => this.showOrderStatusToast(statuses[i], label));
        this.availableCapitalService.invalidate();
      }),
      map(() => undefined),
      catchError((err: HttpErrorResponse) => {
        const message = extractErrorMessage(err);
        labels.forEach((label) => this.presentToast(`${label} failed: ${message}`, 'danger'));
        return of(undefined); // on avale l'erreur pour ne pas bloquer le dismiss
      }),
    );
  }

  buildOrderDetails(): HLOrderDetails {
    const szDec = this.szDecimals();

    const orderType =
      this.orderKind() === 'limit'
        ? { limit: { tif: this.tif() } }
        : {
            trigger: {
              isMarket: this.isMarket(),
              triggerPx: this.triggerPx(),
              tpsl: this.tpsl(),
            },
          };

    return {
      assetName: this.selectedCoin(),
      isBuy: this.isBuy(),
      limitPx: roundPrice(parseFloat(this.limitPx()), szDec),
      sz: roundSize(parseFloat(this.sz()), szDec),
      reduceOnly: this.reduceOnly(),
      orderType,
    };
  }

  submit(): void {
    this.error.set(null);
    const order = this.buildOrderDetails();

    if (!order.assetName || !order.limitPx || !order.sz) {
      this.error.set('Please fill in all required fields.');
      return;
    }

    this.submitting.set(true);

    const existing = this.existingOrder;
    const call$: Observable<HLSuccessResponse<HLPlaceOrderResponse>> =
      this.isModify() && existing
        ? this.hlGateway.modifyOrder(existing.oid, order)
        : this.hlGateway.placeOrder(order);

    call$.subscribe({
      next: (res: HLSuccessResponse<HLPlaceOrderResponse>) => {
        this.submitting.set(false);

        if (this.isModify()) {
          // La réponse de modifyOrder ne contient pas forcément data.statuses:
          // status: 'ok' suffit à confirmer le succès de la modification.
          if (res?.status === 'ok') {
            this.presentToast('Order updated', 'success');
            this.availableCapitalService.invalidate();
            this.modalCtrl.dismiss(null, 'confirm');
          } else {
            this.error.set('Failed to update order.');
          }
          return;
        }

        const statuses: HLPlaceOrderStatus[] = res?.response?.data?.statuses ?? [];
        const first = statuses[0];

        if (first?.error) {
          this.error.set(`Failed: ${first.error}`);
          return;
        }

        this.showOrderStatusToast(first, 'Order');
        this.availableCapitalService.invalidate();

        const mainContext = {
          assetName: this.selectedCoin(),
          isBuy: this.isBuy(),
          limitPx: this.limitPx(),
          sz: this.sz(),
          szDecimals: this.szDecimals(),
          isSpot: this.isSpot(),
        };

        this.submitProtectiveOrders$(mainContext).subscribe(() => {
          this.modalCtrl.dismiss(null, 'confirm');
        });
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(extractErrorMessage(err));
      },
    });
  }
}
