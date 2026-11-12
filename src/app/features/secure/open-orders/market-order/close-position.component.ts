import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { AvailableCapitalService } from '@services/available-capital.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import {
  hlPerpDexOf,
  type HLFrontendOpenOrder,
  type HLPerpPositionDetail,
} from '@syldel/hl-shared-types';
import { extractErrorMessage } from '@utils/hl-error.utils';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import {
  CLOSE_PERCENTS,
  closeSize,
  describeProtectiveAfterClose,
  partialCloseRefusal,
  protectiveOrdersOf,
} from './close-position.util';
import {
  buildMarketOrder,
  isValidMaxSlippage,
  MAX_MAX_SLIPPAGE_PCT,
  MIN_MAX_SLIPPAGE_PCT,
} from './market-execution.util';
import { wideSlippageWarning } from '../open-form/order-guards.util';
import type { MarketFillOutcome } from './market-fill.util';
import {
  MarketOrderConfirmComponent,
  type MarketOrderTicket,
} from './market-order-confirm.component';
import { MarketOrderService } from './market-order.service';

/**
 * ============================================================================
 * « Close market » depuis la carte d'une position : une part de la position (25, 50, 75, 100 % ou
 * une taille libre), fermée par un IOC reduce-only du côté opposé, après la même confirmation
 * qu'un ordre au marché. C'est `market_close` du SDK officiel, avec le choix de la part.
 *
 * Les TP/SL de la paire sont listés avec ce que la fermeture leur fait, et jamais modifiés.
 * ============================================================================
 */
@Component({
  selector: 'app-close-position',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonSpinner,
  ],
  templateUrl: './close-position.component.html',
  styleUrls: ['./close-position.component.scss'],
})
export class ClosePositionComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly marketOrders = inject(MarketOrderService);
  private readonly capital = inject(AvailableCapitalService);

  /** Entrée de modale (`componentProps: { position: () => p }`) : lue, jamais suivie. */
  readonly position = input.required<HLPerpPositionDetail>();

  readonly percents = CLOSE_PERCENTS;
  readonly slippageBounds = { min: MIN_MAX_SLIPPAGE_PCT, max: MAX_MAX_SLIPPAGE_PCT };

  readonly szDecimals = signal<number | null>(null);
  readonly metaError = signal<string | null>(null);
  readonly percent = signal<number | null>(100);
  readonly sz = signal('');
  readonly slippageInput = signal(String(this.marketOrders.maxSlippagePct()));

  readonly protective = signal<HLFrontendOpenOrder[] | null>(null);
  readonly protectiveError = signal<string | null>(null);

  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly outcome = signal<{ tone: 'caution' | 'high'; text: string } | null>(null);
  /** Une fermeture exécutée, même en partie : la feuille ne renvoie plus rien. */
  readonly locked = signal(false);
  readonly checkingPosition = signal(false);

  readonly coin = computed(() => this.position().coin);
  readonly isLong = computed(() => Number(this.position().szi) > 0);
  readonly positionSz = computed(() => Math.abs(Number(this.position().szi)));
  readonly actionLabel = computed(() => (this.isLong() ? 'Close long' : 'Close short'));

  readonly isSlippageInvalid = computed(() => !isValidMaxSlippage(Number(this.slippageInput())));
  /** G4 : un glissement maximal large, dit sans bloquer (`order-guards.util.ts`). */
  readonly slippageWarning = computed(() => wideSlippageWarning(Number(this.slippageInput())));
  readonly isSizeInvalid = computed(() => {
    const sz = Number(this.sz());
    return !(sz > 0) || sz > this.positionSz() + 1e-12;
  });
  readonly remainingSz = computed(() => {
    const remaining = this.positionSz() - Number(this.sz() || 0);
    return remaining > 1e-12 ? Number(remaining.toFixed(this.szDecimals() ?? 8)) : 0;
  });

  /** Une fermeture partielle sous 10 $ : Hyperliquid la refuse (mesuré le 2026-11-12). */
  readonly closeRefusal = computed(() => {
    const szi = Math.abs(Number(this.position().szi));
    const value = Number(this.position().positionValue);
    return partialCloseRefusal({
      closeSz: Number(this.sz()),
      positionSz: this.positionSz(),
      markPx: szi > 0 && value > 0 ? value / szi : null,
    });
  });

  readonly canReview = computed(
    () =>
      this.szDecimals() !== null &&
      !this.isSizeInvalid() &&
      this.closeRefusal() === null &&
      !this.isSlippageInvalid() &&
      !this.sending() &&
      !this.locked() &&
      !this.checkingPosition(),
  );

  readonly describe = describeProtectiveAfterClose;

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit(): void {
    const coin = this.coin();
    this.hlMarket.getMarketMeta(coin).subscribe({
      next: (meta) => {
        this.szDecimals.set(meta.szDecimals);
        this.selectPercent(100);
      },
      error: (error: unknown) =>
        this.metaError.set(
          `The size grid of ${coin} could not be read (${extractErrorMessage(error as Error)}): nothing can be sent.`,
        ),
    });

    const dex = hlPerpDexOf(coin);
    this.hlInfo.getFrontendOpenOrders(dex ?? undefined).subscribe({
      next: (orders) => this.protective.set(protectiveOrdersOf(orders, coin)),
      error: (error: unknown) =>
        this.protectiveError.set(
          `The open TP/SL could not be read (${extractErrorMessage(error as Error)}).`,
        ),
    });

    this.marketOrders.loadMaxSlippage().then(() => {
      this.slippageInput.set(String(this.marketOrders.maxSlippagePct()));
    });
  }

  selectPercent(percent: number): void {
    const decimals = this.szDecimals();
    if (decimals === null) return;
    this.percent.set(percent);
    this.sz.set(closeSize(this.position().szi, percent, decimals));
  }

  onSizeInput(value: string): void {
    this.percent.set(null);
    this.sz.set(value);
  }

  onSlippageInput(value: string): void {
    this.slippageInput.set(value);
    const pct = Number(value);
    if (isValidMaxSlippage(pct)) this.marketOrders.setMaxSlippage(pct);
  }

  async review(): Promise<void> {
    if (!this.canReview()) return;
    const coin = this.coin();
    const szDecimals = this.szDecimals()!;
    const sz = Number(this.sz()).toFixed(szDecimals);
    const isBuy = !this.isLong();

    const modal = await this.modalCtrl.create({
      component: MarketOrderConfirmComponent,
      componentProps: {
        coin: () => coin,
        isBuy: () => isBuy,
        sz: () => sz,
        szDecimals: () => szDecimals,
        reduceOnly: () => true,
        purpose: () => 'close',
        actionLabel: () => this.actionLabel(),
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<MarketOrderTicket>();
    if (role !== 'confirm' || !data) return;

    this.error.set(null);
    this.outcome.set(null);
    this.sending.set(true);
    const order = buildMarketOrder({
      assetName: coin,
      isBuy,
      sz,
      worstPx: data.worstPx,
      reduceOnly: true,
    });
    this.marketOrders.send(order).subscribe((outcome) => {
      this.sending.set(false);
      this.onOutcome(outcome);
    });
  }

  private onOutcome(outcome: MarketFillOutcome): void {
    switch (outcome.kind) {
      case 'not-filled':
      case 'refused':
        this.error.set(outcome.message);
        return;
      case 'unknown':
        this.error.set(outcome.message);
        this.capital.invalidate();
        this.rereadPosition();
        return;
      case 'partial':
        this.locked.set(true);
        this.capital.invalidate();
        this.outcome.set({
          tone: 'caution',
          text: `Partially closed: ${outcome.totalSz} of ${outcome.requestedSz} @ ${outcome.avgPx}. The rest was cancelled: the book did not hold it within the max slippage.`,
        });
        return;
      case 'filled':
        this.locked.set(true);
        this.capital.invalidate();
        this.toastCtrl
          .create({
            message: `${this.actionLabel()} filled · ${outcome.totalSz} @ ${outcome.avgPx}`,
            duration: 3000,
            position: 'top',
            color: 'success',
          })
          .then((toast) => toast.present());
        this.modalCtrl.dismiss(null, 'confirm');
        return;
    }
  }

  /** Après un état inconnu : la position relue UNE fois, et montrée. */
  private rereadPosition(): void {
    const coin = this.coin();
    this.checkingPosition.set(true);
    this.marketOrders.readPositionSize(coin).subscribe({
      next: (szi) => {
        this.checkingPosition.set(false);
        this.outcome.set({
          tone: 'caution',
          text:
            szi === null
              ? `Position re-read: no open position on ${coin} any more.`
              : `Position re-read: ${szi > 0 ? 'long' : 'short'} ${Math.abs(szi)} on ${coin} (was ${this.positionSz()}).`,
        });
      },
      error: (error: unknown) => {
        this.checkingPosition.set(false);
        this.outcome.set({
          tone: 'high',
          text: `The position could not be re-read (${extractErrorMessage(error as Error)}): check it on Hyperliquid before sending again.`,
        });
      },
    });
  }

  dismiss(): void {
    // Une fermeture exécutée a changé le compte : l'appelant relit.
    this.modalCtrl.dismiss(null, this.locked() ? 'confirm' : 'cancel');
  }
}
