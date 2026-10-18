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
import { describeCapitalGap, type AvailableCapital } from '@utils/available-capital.utils';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { MarketPickerModalComponent } from '@shared/components/market-picker-modal/market-picker-modal.component';
import { LISTABLE_EXCHANGE } from '@shared/components/market-picker-modal/market-source.util';
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
import {
  ACTIVE_ASSET_UNAVAILABLE,
  blocksPlacement,
  marketDataNotice,
  marketDataStateOf,
  NO_ASSET_SELECTED,
  PRICE_CHECK_UNSUPPORTED,
  readActiveAsset,
  type ActiveAssetPayload,
  type MarketDataState,
} from './active-asset.util';
import {
  isLimitOnWrongSide,
  limitFromTrigger,
  orderPricesReady,
  type OriginalTriggerOrder,
  type TriggerOrderState,
} from './order-limit.util';

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

  /**
   * Ce que le formulaire sait du marché de l'actif choisi. Tant que le prix manque
   * (`unavailable`, `unsupported`), l'envoi est **bloqué** : sans prix, `isPriceInvalid`
   * rend `false` et le garde-fou « un achat limite ne passe pas au-dessus du marché »
   * cesse de s'exercer. Voir `active-asset.util.ts`.
   */
  marketData = signal<MarketDataState>('none');
  marketNotice = computed(() => marketDataNotice(this.marketData()));
  canRetryMarketData = computed(() => this.marketData() === 'unavailable');
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

  /** Les prix que l'ordre exige sont des nombres : sinon `"NaN"` partirait au serveur. */
  private pricesReady = computed(() =>
    orderPricesReady({
      orderKind: this.orderKind(),
      limitPx: this.limitPx(),
      triggerPx: this.triggerPx(),
    }),
  );

  /**
   * Le limite d'un ordre déclencheur est du mauvais côté du déclencheur (voir
   * `isLimitOnWrongSide`). Distinct de `isPriceInvalid`, qui juge le DÉCLENCHEUR par rapport au
   * marché : ici c'est le limite qui est en cause, et c'est lui qui rougit.
   */
  isLimitSideInvalid = computed(
    () =>
      this.orderKind() === 'trigger' &&
      isLimitOnWrongSide({
        isBuy: this.isBuy(),
        limitPx: this.limitPx(),
        triggerPx: this.triggerPx(),
      }),
  );

  isFormInvalid = computed(() => {
    if (blocksPlacement(this.marketData())) return true;
    const order = this.buildOrderDetails();
    if (!order.assetName || !order.sz) return true;
    if (!this.pricesReady()) return true;
    if (parseFloat(order.sz) <= 0) return true;
    return this.isPriceInvalid() || this.isLimitSideInvalid() || this.isSizeInvalid();
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
  availableCapital = signal<AvailableCapital | null>(null);

  /** Le montant lu, ou `null` — un statut sans montant ne s'affiche pas comme un chiffre. */
  readonly capitalAmount = computed(() => {
    const capital = this.availableCapital();
    return capital?.status === 'ok' ? capital.amount : null;
  });

  /** Et la phrase qui dit pourquoi, quand il n'y a pas de chiffre. */
  readonly capitalGap = computed(() => describeCapitalGap(this.availableCapital()));

  isModify = computed(() => this.mode() === 'modify');

  fetchFn = signal(this.buildFetchFn());

  previousKind = signal<'limit' | 'trigger'>(this.orderKind());

  private defaultSizeApplied = false;
  /**
   * Le prix du marché pré-remplit le prix limite, une fois par actif et par type d'ordre. Un
   * signal : le remettre à `false` doit relancer l'effet qui pré-remplit.
   */
  private priceDefaulted = signal(false);
  /** Les décimales de `szDecimals` sont celles de l'actif choisi, pas du précédent. */
  private szDecimalsKnown = signal(false);

  /**
   * L'utilisateur a saisi le prix limite d'un ordre déclencheur : il fait alors autorité sur
   * le prix dérivé du déclencheur, que ni le sens, ni le TP/SL, ni le déclencheur ne réécrivent
   * plus. Un déclencheur au marché le remet à zéro : son limite est la borne de glissement,
   * toujours dérivée.
   */
  limitEdited = signal(false);

  /** Le limite d'un déclencheur au marché n'est pas un choix : c'est la borne de glissement. */
  limitLocked = computed(() => this.orderKind() === 'trigger' && this.isMarket());

  /** D'où vient le prix limite affiché en mode déclencheur, et à combien du déclencheur. */
  limitOrigin = computed(() => {
    if (this.orderKind() !== 'trigger') return null;
    const trigger = parseFloat(this.triggerPx());
    const limit = parseFloat(this.limitPx());
    if (!trigger || !limit) return null;
    const pct = ((limit - trigger) / trigger) * 100;
    const original = this.originalTrigger();
    const asOpened =
      original !== null &&
      original.triggerPx === this.triggerPx() &&
      original.isMarket === this.isMarket() &&
      original.tpsl === this.tpsl();
    const label = this.limitEdited()
      ? 'edited'
      : asOpened
        ? 'as placed'
        : this.isMarket()
          ? 'exchange bound'
          : `default for ${this.tpsl() === 'sl' ? 'Stop Loss' : 'Take Profit'}`;
    return { pct, label };
  });

  /** L'état d'un ordre déclencheur existant, tel que `ngOnInit` l'affiche. */
  private static triggerStateOf(order: {
    triggerPx?: string | null;
    orderType: string;
  }): TriggerOrderState {
    const type = order.orderType.toLowerCase();
    return {
      triggerPx: order.triggerPx ?? '',
      isMarket: type.includes('market'),
      tpsl: type.includes('stop') ? 'sl' : 'tp',
    };
  }

  private originalTrigger(): OriginalTriggerOrder | null {
    const order = this.existingOrder;
    if (!this.isModify() || !order?.isTrigger) return null;
    return { ...OrderFormComponent.triggerStateOf(order), limitPx: order.limitPx };
  }

  /** Saisie manuelle du prix limite. Vider le champ rend la main au prix dérivé. */
  onLimitInput(value: string): void {
    this.limitPx.set(value);
    if (this.orderKind() === 'trigger') this.limitEdited.set(value !== '');
  }

  constructor() {
    addIcons({ closeOutline, chevronForwardOutline, addOutline, shieldCheckmarkOutline });

    effect(() => {
      const price = this.currentPrice();
      // Une position ouverte (ordre de clôture) fait autorité sur la taille : si elle est
      // arrivée avant le prix, ne pas l'écraser par la taille par défaut.
      if (!price || this.isModify() || this.defaultSizeApplied || this.activePosition()) return;
      untracked(() => {
        this.sz.set((10 / price).toFixed(6));
        this.defaultSizeApplied = true;
      });
    });

    // Le prix du marché pré-remplit le prix limite d'un ordre LIMITE, une fois par actif. Il
    // attend les décimales du marché : arrondir avec celles de l'actif précédent donnerait un
    // prix que l'exchange refuse ou tronque. Un ordre déclencheur ne reçoit RIEN : son côté du
    // marché dépend de TP/SL et du sens, un pourcentage de départ serait inventé, et le prix
    // limite se dérive du déclencheur que l'utilisateur choisit (le marché reste affiché en
    // repère).
    effect(() => {
      const price = this.currentPrice();
      const kind = this.orderKind();
      if (!price || !this.szDecimalsKnown() || this.isModify() || this.priceDefaulted()) return;
      untracked(() => {
        this.priceDefaulted.set(true);
        if (kind === 'limit') {
          this.limitPx.set(roundPrice(price, this.szDecimals(), !!this.isSpot()));
        }
      });
    });

    effect(() => {
      const coin = this.selectedCoin();
      untracked(() => {
        this.fetchFn.set(this.buildFetchFn());
        this.defaultSizeApplied = false;
        this.priceDefaulted.set(false);
        this.szDecimalsKnown.set(false);
        this.limitEdited.set(false);
        // Prix et taille saisis concernaient l'actif PRÉCÉDENT : un stop vendeur à 80080
        // survivait sur un ETH à 2414 (mesuré le 2026-10-16). On repart du marché du
        // nouvel actif. En modification, l'ordre existant garde ses valeurs.
        if (!this.isModify()) {
          this.limitPx.set('');
          this.triggerPx.set('');
          this.sz.set('');
        }
        this.activePosition.set(null);
        // Le prix, le levier et l'état de marché étaient ceux de l'actif PRÉCÉDENT
        // jusqu'à la réponse suivante — et restaient tels quels si elle échouait
        // (le prix de BTC sous un ETH choisi, mesuré le 2026-10-16).
        this.currentPrice.set(null);
        this.leverage.set(null);
        this.marketData.set('none');
        if (!coin) return;
        if (this.isSpot()) {
          this.hlMarket.getSpotMeta().subscribe((meta) => {
            const market = meta.tokens.find((m) => m.name === coin || coin.includes(m.name));
            if (market) {
              this.szDecimals.set(market.szDecimals);
              this.szDecimalsKnown.set(true);
            }
          });
        } else {
          const dex = this.hlMarket.extractDex(coin);
          this.hlMarket.getPerpMeta(dex).subscribe((meta) => {
            const market = meta.universe.find((m) => m.name === coin || coin.includes(m.name));
            if (market) {
              this.szDecimals.set(market.szDecimals);
              this.maxLeverage.set(market.maxLeverage);
              this.szDecimalsKnown.set(true);
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
          // Un limite et un déclencheur sont deux ordres de nature différente : le prix saisi
          // pour l'un n'a pas de sens pour l'autre (un déclencheur dérivé d'un prix d'entrée
          // limite à ±0,1 % ne voulait rien dire). Les deux champs repartent vides ; un ordre
          // limite reçoit à nouveau le prix du marché.
          this.limitPx.set('');
          this.triggerPx.set('');
          this.limitEdited.set(false);
          this.priceDefaulted.set(false);
        }
        if (kind !== 'trigger') {
          this.activePosition.set(null);
        }
      });
    });

    // Le prix limite d'un ordre déclencheur se dérive du déclencheur (la décision) : voir
    // `order-limit.util.ts` pour les écarts. Tout ce qui le détermine est lu ICI pour être
    // suivi ; le bloc `untracked` ne suit rien.
    effect(() => {
      const triggerPx = this.triggerPx();
      const isBuy = this.isBuy();
      const tpsl = this.tpsl();
      const isMarket = this.isMarket();
      const orderKind = this.orderKind();
      untracked(() => {
        // Au marché, le limite est la borne de glissement : jamais une saisie.
        if (isMarket && this.limitEdited()) this.limitEdited.set(false);
        const limit = limitFromTrigger({
          original: this.originalTrigger(),
          orderKind,
          triggerPx,
          isMarket,
          tpsl,
          isBuy,
          szDecimals: this.szDecimals(),
          isSpot: !!this.isSpot(),
        });
        if (limit === null) return;
        // Un limite saisi à la main fait autorité (ni le sens, ni TP/SL, ni le déclencheur ne
        // le réécrivent) — sauf au marché, où il n'y a pas de saisie.
        if (this.limitEdited() && !isMarket) return;
        this.limitPx.set(limit);
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
        const state = OrderFormComponent.triggerStateOf(existing);
        this.tpsl.set(state.tpsl);
        this.isMarket.set(state.isMarket);
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

  /**
   * Le type de retour est explicite : sans lui, TypeScript infère l'union de plusieurs
   * fonctions et le gabarit ne sait plus quel `T` donner à `RefreshableLayout` (TS2322,
   * mesuré le 2026-10-16).
   *
   * Aucun de ces cas ne rend `null` : le layout le lit comme « vide » et ferait disparaître
   * le formulaire. Chacun a son marqueur nommé (`active-asset.util.ts`).
   */
  private buildFetchFn(): () => Observable<ActiveAssetPayload> {
    const selectedCoin = this.selectedCoin();
    if (!selectedCoin) return () => of(NO_ASSET_SELECTED);

    // `activeAssetData` est une requête de perps : l'API répond 500 pour un actif spot
    // (mesuré sur `PURR/USDC`). On ne l'envoie pas — elle échouerait à coup sûr, pour
    // rien, et sur le poids d'IP.
    if (this.isSpot()) {
      return () => {
        this.loadCapital(selectedCoin);
        return of(PRICE_CHECK_UNSUPPORTED);
      };
    }

    return () => {
      this.loadCapital(selectedCoin);
      return this.loadActiveAssetData(selectedCoin);
    };
  }

  /** Relance le chargement du prix : le même appel que le changement d'actif. */
  retryMarketData(): void {
    this.fetchFn.set(this.buildFetchFn());
  }

  onDataLoaded(data: ActiveAssetPayload): void {
    const reading = readActiveAsset(data);
    const state = marketDataStateOf(reading);
    // « Rien à lire » : l'état en place ne bouge pas.
    if (state === null) return;
    this.marketData.set(state);

    if (reading.status === 'ok') {
      this.currentPrice.set(reading.price);
      this.leverage.set(reading.leverage);
      return;
    }

    // Dans tous les autres cas le prix est INCONNU : `null`, jamais `NaN` (le gabarit
    // l'afficherait) ni le prix de l'actif précédent (faux pour celui-ci).
    this.currentPrice.set(null);
    if (reading.status === 'unreadable-price') {
      console.error(
        `[OrderForm] ${this.selectedCoin()}: the mark price is not a price (${JSON.stringify(reading.raw)}).`,
      );
      this.leverage.set(reading.leverage);
      return;
    }
    this.leverage.set(null);
  }

  private loadCapital(pairName: string): void {
    if (!pairName) {
      this.availableCapital.set(null);
      return;
    }
    // Le dex ne s'extrait plus du nom : le gateway résout le collatéral depuis
    // le catalogue, lui seul sait de quel dex relève le marché.
    this.availableCapitalService.getAvailableCapital(pairName).subscribe({
      next: (capital) => this.availableCapital.set(capital),
      error: () => this.availableCapital.set({ status: 'unavailable' }),
    });
  }

  /**
   * Un échec rend `ACTIVE_ASSET_UNAVAILABLE`, pas `null`. Il rendait `null`, que
   * `RefreshableLayout` lit comme « vide » : tout le formulaire disparaissait derrière
   * « No data found », sans toast, la cause dans la console seulement (mesuré le
   * 2026-10-16). Le formulaire reste maintenant affiché, dit l'échec, et bloque l'envoi
   * tant que le prix manque. Voir `docs/roadmap.md`, « Risques identifiés ».
   */
  private loadActiveAssetData(
    coin: string,
  ): Observable<HlActiveAssetData | typeof ACTIVE_ASSET_UNAVAILABLE> {
    return this.hlInfo.getActiveAssetData(coin).pipe(
      catchError((err) => {
        console.error('loadActiveAssetData error', err);
        return of(ACTIVE_ASSET_UNAVAILABLE);
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
        exchangeKey: () => LISTABLE_EXCHANGE,
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

    // Le bouton est désactivé dans ce cas, mais `submit()` est public : le refus ne doit
    // pas dépendre du seul bouton.
    if (blocksPlacement(this.marketData())) {
      this.error.set(marketDataNotice(this.marketData()));
      return;
    }

    const order = this.buildOrderDetails();

    if (!order.assetName || !order.sz || !this.pricesReady()) {
      this.error.set('Please fill in all required fields.');
      return;
    }

    if (this.isLimitSideInvalid()) {
      this.error.set(
        `The limit price must be ${this.isBuy() ? 'at or above' : 'at or below'} the trigger price.`,
      );
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
