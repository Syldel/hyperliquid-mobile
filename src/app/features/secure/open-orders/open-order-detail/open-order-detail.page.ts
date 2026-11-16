import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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
  IonRouterOutlet,
  ModalController,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { AccountActivityService } from '@services/account-activity.service';
import { AvailableCapitalService } from '@services/available-capital.service';
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
import { exchangeRefusal, extractErrorMessage } from '@utils/hl-error.utils';
import { orderSideLabel } from '@utils/market-kind.util';
import { addIcons } from 'ionicons';
import { closeOutline, createOutline, trashOutline } from 'ionicons/icons';
import { of, switchMap } from 'rxjs';
import { editRefusal } from '../editable-order.util';
import { afterModify, ModifyOutcome } from '../modify-outcome.util';
import { OrderFormComponent } from '../open-form/order-form.component';
import { describeStuckTriggered, isStuckTriggeredOrder } from '../stuck-triggered-order.util';
import { AgentExpiryNoticeComponent } from '@shared/components/agent-expiry-notice/agent-expiry-notice.component';

@Component({
  selector: 'app-open-order-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AgentExpiryNoticeComponent,
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
  /** Un stop déclenché dont l'ordre est resté au carnet (voir `stuck-triggered-order.util.ts`). */
  readonly isStuckTriggered = isStuckTriggeredOrder;

  /** Ce qu'on en dit, avec son limite : entier, ou exécuté en partie. */
  readonly stuckTriggeredText = (order: HLOrderStatusDetails) =>
    describeStuckTriggered(order, true);

  private readonly route = inject(ActivatedRoute);
  private readonly hlGateway = inject(HyperliquidGatewayService);
  private readonly market = inject(HyperliquidMarketService);
  private readonly alertCtrl = inject(AlertController);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly availableCapitalService = inject(AvailableCapitalService);
  private readonly activity = inject(AccountActivityService);
  private readonly location = inject(Location);
  private readonly navCtrl = inject(NavController);
  private readonly outlet = inject(IonRouterOutlet, { optional: true });

  oid = signal<number | null>(null);
  coin = signal<string>('');
  order = signal<HLOrderStatusDetails | null>(null);
  cancelling = signal(false);
  orderStatus = signal<HLOrderStatus | null>(null);
  statusTimestamp = signal<Timestamp | null>(null);
  coinTitle = signal<string>('—');

  fetchFn = signal(this.buildFetchFn());

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

  /**
   * Pourquoi cet ordre ne se modifie pas ici (un trailing stop natif, un type inconnu), ou `null`.
   * Le bouton est désactivé **et** la raison s'affiche : un bouton grisé sans explication est une
   * défaillance muette (voir `editable-order.util.ts`).
   */
  readonly editRefusal = computed(() => {
    const order = this.order();
    return order ? editRefusal(order) : null;
  });

  protected readonly orderSideLabel = computed(() => {
    const order = this.order();
    return order ? this.getOrderLabel(order) : '';
  });

  readonly orderSideColor = computed(() => {
    const order = this.order();
    return order?.side === 'B' ? 'success' : 'danger';
  });

  constructor() {
    super();
    addIcons({ trashOutline, createOutline, closeOutline });
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
    if (!current || this.editRefusal()) return;

    const writeBefore = this.activity.lastWrite();
    const modal = await this.modalCtrl.create({
      component: OrderFormComponent,
      componentProps: {
        existingOrder: current,
      },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<ModifyOutcome>();

    if (role === 'confirm' && data && data.kind !== 'refused') {
      this.followModify(data);
      return;
    }
    // Fermé sans succès, mais après une écriture : un `modify` refusé annule souvent l'original (mesuré
    // le 2026-10-27 et le 2026-11-09). Sans cette relecture, la page restait sur « open ».
    if (this.activity.lastWrite() !== writeBefore) {
      this.fetchFn.set(this.buildFetchFn());
    }
  }

  /**
   * Une modification **remplace** l'ordre : l'ancien oid est `canceled`. La page relisait cet ancien oid
   * et affichait « canceled » après un succès. Elle passe désormais au nouvel ordre — l'URL remplacée,
   * pour qu'un retour arrière ne ramène pas l'ancien — ou, si la réponse ne dit pas lequel, à la liste.
   */
  private followModify(outcome: Exclude<ModifyOutcome, { kind: 'refused' }>): void {
    const { show, message } = afterModify(outcome);
    this.showToast(message, 'success');
    if (show === null) {
      this.backToList();
      return;
    }
    this.oid.set(show);
    this.orderStatus.set(null);
    this.statusTimestamp.set(null);
    this.location.replaceState(
      '/secure/open-orders/detail',
      new URLSearchParams({ oid: String(show), coin: this.coin() }).toString(),
    );
    this.fetchFn.set(this.buildFetchFn());
  }

  /**
   * Retour à la liste **telle qu'on l'a laissée** : son filtre et sa sélection de dex. La navigation
   * d'avant imposait `?coin=` — mesuré le 2026-11-15, une liste ouverte sans filtre depuis le menu
   * revenait filtrée sur le marché de l'ordre annulé. La page de détail ne s'ouvre que depuis la liste ;
   * sans elle dans la pile (un lien direct), on y va comme le bouton retour (`defaultHref`).
   */
  private backToList(): void {
    if (this.outlet?.canGoBack()) {
      void this.navCtrl.back();
      return;
    }
    void this.navCtrl.navigateBack('/secure/open-orders', { queryParams: { coin: this.coin() } });
  }

  private getOrderLabel(order: HLOrderStatusDetails | null): string {
    if (!order) {
      return '';
    }

    // Long / Short est le vocabulaire d'un perp ; spot, outcome et nom douteux se disent Buy / Sell.
    return orderSideLabel(this.coin(), order.side === 'B');
  }

  async confirmCancel(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Cancel order',
      message: `Cancel ${this.getOrderLabel(this.order())} order on ${this.coin()} ?`,
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
          // Refus d'ensemble (`response` est alors un texte) : lire
          // `response.data.statuses` levait une TypeError dans ce rappel, et
          // rien ne s'affichait.
          const refusal = exchangeRefusal(res);
          if (refusal) {
            this.showToast(`Cancel failed: ${refusal}`, 'danger');
            return;
          }
          const status = res?.response?.data?.statuses?.[0];
          if (status === undefined) {
            this.showToast('Cancel failed: unexpected reply from the gateway.', 'danger');
            return;
          }
          if (status === 'success') {
            this.showToast(`Order ${this.oid()} cancelled`, 'success');
            this.availableCapitalService.invalidate();
            // La liste se relit à son retour (`OpenOrdersPage.ionViewWillEnter`).
            this.backToList();
          } else {
            this.showToast(`Cancel failed: ${status.error}`, 'danger');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.cancelling.set(false);
          this.showToast(extractErrorMessage(err), 'danger');
        },
      });
  }

  private showToast(message: string, color: 'success' | 'danger' | 'primary' = 'primary'): void {
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
}
