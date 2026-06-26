import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  ModalController,
} from '@ionic/angular/standalone';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import {
  HLOrderStatus,
  HLOrderStatusDetails,
  HLOrderStatusResponse,
  Timestamp,
} from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import { createOutline, trashOutline } from 'ionicons/icons';
import { of, switchMap } from 'rxjs';
import { OrderFormComponent } from '../open-form/order-form.component';

@Component({
  selector: 'app-open-order-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RefreshableLayoutComponent,
    IonButton,
    IonIcon,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    DatePipe,
    DecimalPipe,
  ],
  templateUrl: './open-order-detail.page.html',
  styleUrls: ['./open-order-detail.page.scss'],
})
export class OpenOrderDetailPage extends MenuBasePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly hlGateway = inject(HyperliquidGatewayService);
  private readonly market = inject(HyperliquidMarketService);
  private readonly alertCtrl = inject(AlertController);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly modalCtrl = inject(ModalController);

  oid = signal<number | null>(null);
  coin = signal<string>('');
  order = signal<HLOrderStatusDetails | null>(null);
  cancelling = signal(false);
  orderStatus = signal<HLOrderStatus | null>(null);
  statusTimestamp = signal<Timestamp | null>(null);
  coinTitle = signal<string>('—');

  fetchFn = signal(this.buildFetchFn());

  isSpot = computed(() => {
    const coin = this.coin();
    return coin.includes('/') || coin.includes('-');
  });

  statusColor = computed(() => {
    switch (this.orderStatus()) {
      case 'open':
        return 'success';
      case 'canceled':
        return 'medium';
      case 'filled':
        return 'primary';
      case 'triggered':
        return 'tertiary';
      default:
        return 'medium';
    }
  });

  sizeUsd = computed(() => {
    const o = this.order();
    if (!o) return null;
    const sz = parseFloat(o.sz);
    const px = parseFloat(o.limitPx);
    if (!sz || !px) return null;
    return sz * px;
  });

  origSizeUsd = computed(() => {
    const o = this.order();
    if (!o) return null;
    const sz = parseFloat(o.origSz);
    const px = parseFloat(o.limitPx);
    if (!sz || !px) return null;
    return sz * px;
  });

  constructor() {
    super();
    addIcons({ trashOutline, createOutline });
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const oid = Number(params.get('oid'));
    const coin = params.get('coin') ?? '';
    this.oid.set(oid);
    this.coin.set(coin);

    const stateOrder = history.state?.order as HLOrderStatusDetails | undefined;
    if (stateOrder) this.order.set(stateOrder);

    this.fetchFn.set(this.buildFetchFn());

    this.hlMarket.resolveCoin(coin).subscribe((name) => this.coinTitle.set(name));
  }

  private buildFetchFn() {
    const oid = this.oid();
    if (!oid) return () => of(null);
    return () => this.hlGateway.getOrderStatus(oid);
  }

  onDataLoaded(data: HLOrderStatusResponse | null): void {
    if (data?.order?.order) this.order.set(data.order.order);
    if (data?.order?.status) this.orderStatus.set(data.order.status);
    if (data?.order?.statusTimestamp) this.statusTimestamp.set(data.order.statusTimestamp);
  }

  async openEditModal(): Promise<void> {
    const current = this.order();
    if (!current) return;

    const modal = await this.modalCtrl.create({
      component: OrderFormComponent,
      componentProps: {
        existingOrder: current,
      },
    });
    await modal.present();
    const { role } = await modal.onWillDismiss();
    if (role === 'confirm') {
      // Rafraîchit les données de la page
      this.fetchFn.set(this.buildFetchFn());
    }
  }

  async confirmCancel(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Cancel order',
      message: `Cancel ${this.order()?.side === 'B' ? 'Buy' : 'Sell'} order on ${this.coin()} ?`,
      buttons: [
        { text: 'Back', role: 'cancel' },
        {
          text: 'Confirm',
          role: 'destructive',
          handler: () => this.doCancel(),
        },
      ],
    });
    await alert.present();
  }

  private doCancel(): void {
    const oid = this.oid();
    const coin = this.coin();
    if (!oid || !coin) return;

    this.cancelling.set(true);
    this.market
      .getAssetIndex(coin)
      .pipe(switchMap((asset) => this.hlGateway.cancelOrder([{ asset, oid }])))
      .subscribe({
        next: (res) => {
          this.cancelling.set(false);
          const status = res.data.statuses[0];
          if (status === 'success') {
            this.router.navigate(['/secure/open-orders'], {
              queryParams: { coin: this.coin() },
            });
          } else {
            console.error('Cancel failed:', status.error);
          }
        },
        error: () => {
          this.cancelling.set(false);
        },
      });
  }
}
