import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import type { HlActiveAssetLeverage } from '@syldel/hl-shared-types';
import { extractErrorMessage } from '@utils/hl-error.utils';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { estimateLiquidation, type LiquidationEstimate } from './liquidation-estimate.util';
import { walkBook, worstPrice } from './market-execution.util';
import { MarketOrderService, type TakerRate } from './market-order.service';
import { assessMarketRisk, describeFunding, formatPct } from './market-risk.util';
import {
  MARKET_SNAPSHOT_MAX_AGE_MS,
  type MarketSnapshot,
  type SnapshotReading,
} from './market-snapshot.util';

/** Ce que la confirmation rend à son appelant : le prix plafond affiché, et rien d'autre. */
export interface MarketOrderTicket {
  worstPx: string;
  /** Le mid sur lequel ce plafond a été calculé. */
  mid: number;
  readAt: number;
}

/**
 * ============================================================================
 * La confirmation d'un ordre au marché. Toujours affichée, sans option pour s'en passer (décidé
 * le 2026-11-12) : un ordre au marché part au prix du carnet, et c'est ici qu'on voit lequel.
 *
 * Elle lit le marché une fois à l'ouverture (`MarketOrderService.readSnapshot`), montre le prix
 * plafond qui partira, le coût estimé de CETTE taille dans le carnet, les frais, le verdict de
 * risque critère par critère, et — en ouverture, en isolé — le prix de liquidation estimé.
 *
 * Elle n'envoie rien : elle rend le plafond à l'appelant, qui envoie. Passé
 * `MARKET_SNAPSHOT_MAX_AGE_MS`, la confirmation exige une relecture.
 * ============================================================================
 */
@Component({
  selector: 'app-market-order-confirm',
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
    IonSpinner,
  ],
  templateUrl: './market-order-confirm.component.html',
  styleUrls: ['./market-order-confirm.component.scss'],
})
export class MarketOrderConfirmComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly marketOrders = inject(MarketOrderService);
  private readonly destroyRef = inject(DestroyRef);

  // Entrées de modale (`componentProps: { x: () => valeur }`) : lues, jamais suivies.
  readonly coin = input.required<string>();
  readonly coinTitle = input<string>('');
  readonly isBuy = input.required<boolean>();
  readonly sz = input.required<string>();
  readonly szDecimals = input.required<number>();
  readonly reduceOnly = input<boolean>(false);
  readonly purpose = input<'open' | 'close'>('open');
  /** « Long », « Sell », « Close long »… : le mot du bouton qui a mené ici. */
  readonly actionLabel = input.required<string>();
  readonly leverage = input<HlActiveAssetLeverage | null>(null);
  /** `null` : on ne sait pas s'il y a déjà une position sur la paire. */
  readonly hasPosition = input<boolean | null>(null);

  readonly reading = signal<SnapshotReading | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly takerRate = signal<TakerRate | null>(null);
  /** L'horloge qui fait vieillir la photographie ; un signal pour que l'âge se recalcule. */
  readonly now = signal(Date.now());

  readonly maxSlippagePct = this.marketOrders.maxSlippagePct;
  readonly formatPct = formatPct;

  readonly snapshot = computed((): MarketSnapshot | null => {
    const reading = this.reading();
    return reading?.status === 'ok' ? reading.snapshot : null;
  });

  readonly unavailableReason = computed(() => {
    const reading = this.reading();
    return reading?.status === 'unavailable' ? reading.reason : null;
  });

  readonly szNum = computed(() => Number(this.sz()));

  readonly worstPx = computed(() => {
    const snap = this.snapshot();
    if (!snap) return null;
    return worstPrice(snap.mid, this.isBuy(), this.maxSlippagePct(), this.szDecimals());
  });

  readonly walk = computed(() => {
    const snap = this.snapshot();
    const worst = this.worstPx();
    if (!snap || worst === null) return null;
    return walkBook(snap.book, this.isBuy(), this.szNum(), Number(worst));
  });

  readonly risk = computed(() => {
    const snap = this.snapshot();
    const walk = this.walk();
    if (!snap || !walk) return null;
    return assessMarketRisk({
      sz: this.szNum(),
      bid: snap.bid,
      ask: snap.ask,
      mid: snap.mid,
      walk,
      markPx: snap.markPx,
      oraclePx: snap.oraclePx,
      dayNtlVlm: snap.dayNtlVlm,
    });
  });

  /** Le notionnel estimé : la part remplissable à son prix moyen, sinon la taille au mid. */
  readonly estNotional = computed(() => {
    const snap = this.snapshot();
    const walk = this.walk();
    if (!snap) return null;
    if (walk?.avgPx != null) return walk.fillableSz * walk.avgPx;
    return this.szNum() * snap.mid;
  });

  readonly estFees = computed(() => {
    const notional = this.estNotional();
    const rate = this.takerRate();
    if (notional === null || !rate) return null;
    return notional * rate.rate;
  });

  readonly liquidation = computed((): LiquidationEstimate | null => {
    if (this.purpose() !== 'open') return null;
    const snap = this.snapshot();
    if (!snap) return null;
    return estimateLiquidation({
      reduceOnly: this.reduceOnly(),
      isBuy: this.isBuy(),
      sz: this.szNum(),
      entryPx: this.walk()?.avgPx ?? null,
      markPx: snap.markPx,
      leverage: this.leverage(),
      hasPosition: this.hasPosition(),
      marginTableId: snap.marginTableId,
      marginTables: snap.marginTables,
    });
  });

  readonly funding = computed(() => {
    if (this.purpose() !== 'open') return null;
    return describeFunding(this.snapshot()?.funding ?? null, this.isBuy());
  });

  readonly ageSeconds = computed(() => {
    const snap = this.snapshot();
    if (!snap) return null;
    return Math.max(0, Math.floor((this.now() - snap.readAt) / 1000));
  });

  readonly stale = computed(() => {
    const snap = this.snapshot();
    return !!snap && this.now() - snap.readAt > MARKET_SNAPSHOT_MAX_AGE_MS;
  });

  readonly canConfirm = computed(
    () => !this.loading() && this.worstPx() !== null && !this.stale() && this.szNum() > 0,
  );

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit(): void {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
    this.refresh();
  }

  /** Relit le marché : à l'ouverture, et sur demande quand la photographie a vieilli. */
  refresh(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.marketOrders.readSnapshot(this.coin()).subscribe({
      next: (reading) => {
        this.reading.set(reading);
        this.now.set(Date.now());
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.reading.set(null);
        this.loadError.set(`Could not read the market: ${extractErrorMessage(error as Error)}`);
        this.loading.set(false);
      },
    });
    this.marketOrders.takerRate().subscribe((rate) => this.takerRate.set(rate));
  }

  confirm(): void {
    const worst = this.worstPx();
    const snap = this.snapshot();
    // Le bouton est désactivé dans ces cas ; `confirm()` est public, le refus ne dépend pas de lui.
    if (!this.canConfirm() || worst === null || !snap) return;
    const ticket: MarketOrderTicket = { worstPx: worst, mid: snap.mid, readAt: snap.readAt };
    this.modalCtrl.dismiss(ticket, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
