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
  HLSuccessResponse,
  HLTif,
} from '@syldel/hl-shared-types';
import { roundPrice, roundSize } from 'app/core/utils/hl-rounding.utils';
import { addIcons } from 'ionicons';
import { chevronForwardOutline, closeOutline } from 'ionicons/icons';
import { catchError, Observable, of } from 'rxjs';

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

  priceDiffPct = computed(() => {
    const current = this.currentPrice();
    const limit = parseFloat(this.limitPx());
    if (!current || !limit || isNaN(limit)) return null;
    return ((limit - current) / current) * 100;
  });
  isPriceInvalid = computed(() => {
    const pct = this.priceDiffPct();
    if (pct === null) return false;
    const isBuy = this.isBuy();
    const isReduce = this.reduceOnly();
    return isReduce ? (isBuy ? pct < 0 : pct > 0) : isBuy ? pct > 0 : pct < 0;
  });
  priceDiffClass = computed(() =>
    this.priceDiffPct() === null ? '' : this.isPriceInvalid() ? 'diff--danger' : '',
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
    addIcons({ closeOutline, chevronForwardOutline });

    effect(() => {
      const price = this.currentPrice();
      if (!price || this.isModify()) return;
      untracked(() => {
        this.sz.set((10 / price).toFixed(6));
      });
    });

    effect(() => {
      const coin = this.selectedCoin();
      untracked(() => {
        this.fetchFn.set(this.buildFetchFn());
        if (!coin) return;
        if (this.isSpot()) {
          this.hlMarket.getSpotMeta().subscribe((meta) => {
            const market = meta.tokens.find((m) => m.name === coin || coin.includes(m.name));
            if (market) this.szDecimals.set(market.szDecimals);
          });
        } else {
          this.hlMarket.getPerpMeta().subscribe((meta) => {
            const market = meta.universe.find((m) => m.name === coin || coin.includes(m.name));
            if (market) {
              this.szDecimals.set(market.szDecimals);
              this.maxLeverage.set(market.maxLeverage);
            }
          });
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
        if (kindChanged) this.isBuy.set(!isBuy);
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

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
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
    const call$: import('rxjs').Observable<HLSuccessResponse<HLPlaceOrderResponse>> =
      this.isModify() && existing
        ? this.hlGateway.modifyOrder(existing.oid, order)
        : this.hlGateway.placeOrder(order);

    call$.subscribe({
      next: (res: HLSuccessResponse<HLPlaceOrderResponse>) => {
        this.submitting.set(false);

        const statuses = res?.response?.data?.statuses ?? [];
        const first = statuses[0];

        if (first?.error) {
          this.error.set(`Failed: ${first.error}`);
          return;
        }

        const oid = first?.resting?.oid ?? first?.filled?.oid;
        const isModify = this.isModify();

        let message: string;
        if (isModify) {
          message = oid ? `Order updated · OID ${oid}` : 'Order updated';
        } else if (first?.filled) {
          const { totalSz, avgPx } = first.filled;
          message = oid
            ? `Filled · sz ${totalSz} @ ${avgPx} · OID ${oid}`
            : `Filled · sz ${totalSz} @ ${avgPx}`;
        } else {
          message = oid ? `Order placed · OID ${oid}` : 'Order placed';
        }

        this.toastCtrl
          .create({
            message,
            duration: 3000,
            position: 'top',
            color: first?.filled ? 'success' : 'primary',
            buttons: [{ icon: 'close-outline', role: 'cancel' }],
          })
          .then((t) => t.present());

        this.modalCtrl.dismiss(null, 'confirm');
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(this.extractErrorMessage(err));
      },
    });
  }

  private extractErrorMessage(err: HttpErrorResponse): string {
    if (err.status === 0) {
      return 'Network error (offline, DNS failure, CORS restriction, SSL error, timeout, or server unreachable).';
    }

    const body = err.error;
    if (typeof body?.message === 'string' && body.message) {
      return `[HTTP ${err.status}] ${body.message}`;
    }
    if (typeof body?.error === 'string' && body.error) {
      return `[HTTP ${err.status}] ${body.error}`;
    }
    if (typeof body === 'string' && body) {
      return `[HTTP ${err.status}] ${body}`;
    }

    return `[HTTP ${err.status}] ${err.message}`;
  }
}
