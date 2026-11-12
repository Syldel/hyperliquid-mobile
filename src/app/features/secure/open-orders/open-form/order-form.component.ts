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
import { isPerpMarket, isSpotMarket } from '@utils/market-kind.util';
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
  hlPerpDexOf,
} from '@syldel/hl-shared-types';
import {
  asSentence,
  exchangeRefusal,
  extractErrorMessage,
  modifyRefusal,
} from '@utils/hl-error.utils';
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
import { catchError, map, Observable, of } from 'rxjs';
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
  blocksOnMarketMeta,
  marketMetaDetailOf,
  marketMetaNotice,
  marketMetaStateOf,
  type MarketMetaState,
} from './market-meta-state.util';
import {
  isLimitOnWrongSide,
  isStopLimitTight,
  limitFromTrigger,
  notionalPrice,
  orderPricesReady,
  stopLimitSpread,
  type OrderKind,
  type OriginalTriggerOrder,
  type TriggerOrderState,
} from './order-limit.util';
import { AgentExpiryNoticeComponent } from '@shared/components/agent-expiry-notice/agent-expiry-notice.component';
import {
  MarketOrderConfirmComponent,
  type MarketOrderTicket,
} from '../market-order/market-order-confirm.component';
import { buildMarketOrder, isValidMaxSlippage } from '../market-order/market-execution.util';
import type { MarketFillOutcome } from '../market-order/market-fill.util';
import { MarketOrderService } from '../market-order/market-order.service';
import { MIN_MAX_SLIPPAGE_PCT, MAX_MAX_SLIPPAGE_PCT } from '../market-order/market-execution.util';
import {
  crossingCloseLimitWarning,
  marginShortfallWarning,
  openingSize,
  positionEffect,
  wideSlippageWarning,
  type OpenPosition,
} from './order-guards.util';

export type OrderFormMode = 'place' | 'modify';

/**
 * Une fermeture préparée depuis la carte d'une position (« Close limit ») : le sens de clôture et
 * la taille de la position, en reduce-only. Une propriété ordinaire comme `existingOrder` et
 * `defaultCoin`, lue une fois.
 */
export interface ClosePreset {
  coin: string;
  isBuy: boolean;
  sz: string;
}

/** Le contexte d'un ordre exécuté, et les protections qu'il reste à poser dessus. */
interface UnprotectedFill {
  context: {
    assetName: string;
    isBuy: boolean;
    limitPx: string;
    sz: string;
    szDecimals: number;
    isSpot: boolean;
  };
  items: ProtectiveOrderResult[];
  message: string;
}

@Component({
  selector: 'app-order-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AgentExpiryNoticeComponent,
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
  private readonly marketOrders = inject(MarketOrderService);

  existingOrder: HLFrontendOpenOrder | null = null;
  defaultCoin: string = '';
  closePreset: ClosePreset | null = null;

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
  /**
   * La grille (`szDecimals`, levier maximal) lue dans la méta du marché choisi, par égalité exacte.
   * Tant qu'elle ne l'est pas — en cours, introuvable, méta indisponible —, l'envoi est **bloqué** :
   * `roundSize` et `roundPrice` arrondissent sur cette grille, et celle d'un autre marché déplace la
   * taille ou le prix qui partent. Voir `market-meta-state.util.ts`.
   */
  marketMeta = signal<MarketMetaState>('none');
  private marketMetaDetail = signal<string | null>(null);
  marketMetaMessage = computed(() =>
    marketMetaNotice(this.marketMeta(), this.selectedCoin(), this.marketMetaDetail()),
  );
  canRetryMarketMeta = computed(() => this.marketMeta() === 'unavailable');
  activePosition = signal<{ isBuy: boolean; sz: string; entryPx: string } | null>(null);

  protectiveOrders = signal<ProtectiveOrderResult[]>([]);
  showProtectiveSection = computed(
    () => (this.orderKind() === 'limit' || this.orderKind() === 'market') && !this.isModify(),
  );

  /**
   * Le prix depuis lequel les protections s'affichent pendant la saisie. Limite : le prix limite.
   * Marché : le prix du marché, à titre INDICATIF — les protections partent après l'exécution,
   * ancrées sur le prix moyen obtenu et dimensionnées sur la taille remplie (décidé le 2026-11-12,
   * comme Freqtrade, « placed on the exchange immediately after buy order fills », et comme le bot,
   * `hl-protection.service.ts`).
   */
  protectiveRefPx = computed(() => {
    if (this.orderKind() !== 'market') return this.limitPx();
    const price = this.currentPrice();
    return price ? roundPrice(price, this.szDecimals(), false) : '';
  });
  canAddProtectiveOrder = computed(() => !!this.protectiveRefPx() && parseFloat(this.sz()) > 0);

  // ── Ordre au marché ────────────────────────────────────────────────────────

  /** Le glissement saisi, en texte : la saisie en cours n'est pas encore un nombre valide. */
  slippageInput = signal(String(this.marketOrders.maxSlippagePct()));
  readonly slippageBounds = { min: MIN_MAX_SLIPPAGE_PCT, max: MAX_MAX_SLIPPAGE_PCT };
  isSlippageInvalid = computed(() => !isValidMaxSlippage(Number(this.slippageInput())));

  /** Un perp : l'ordre au marché ne se propose que là (décidé le 2026-11-12). */
  isPerpCoin = computed(() => isPerpMarket(this.selectedCoin() ?? ''));

  /**
   * Un ordre au marché est parti et a été exécuté, en tout ou en partie : le formulaire ne renvoie
   * plus rien. Le même bouton renverrait le même ordre, une seconde fois.
   */
  marketLocked = signal(false);
  /** Ce qu'il est advenu de l'ordre, quand le formulaire reste ouvert pour le dire. */
  marketOutcome = signal<{ tone: 'ok' | 'caution' | 'high'; text: string } | null>(null);
  /** L'ordre est exécuté, une partie de ses protections n'a pas été posée. */
  unprotected = signal<UnprotectedFill | null>(null);
  retryingProtection = signal(false);
  /** Après un état inconnu : la position relue une fois, tant qu'elle n'est pas affichée. */
  checkingPosition = signal(false);

  priceDiffPct = computed(() => {
    const current = this.currentPrice();
    const limit = parseFloat(this.limitPx());
    if (!current || !limit || isNaN(limit)) return null;
    return ((limit - current) / current) * 100;
  });
  isPriceInvalid = computed(() => {
    // Un ordre au marché n'a pas de prix saisi : son plafond est calculé, du bon côté par construction.
    if (this.orderKind() === 'market') return false;
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
    const price = notionalPrice({
      orderKind: this.orderKind(),
      isMarketTrigger: this.isMarket(),
      limitPx: this.limitPx(),
      triggerPx: this.triggerPx(),
      currentPrice: this.currentPrice(),
    });
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

  /**
   * Un Stop Loss LIMITE dont le limite est si proche du déclencheur qu'il peut se déclencher sans
   * s'exécuter. Un AVERTISSEMENT, pas un blocage : le cas est légitime à tester, et le seuil est un
   * choix (voir `STOP_LIMIT_TIGHT_BELOW`). Mesuré le 2026-10-18 : limite égal au déclencheur, ordre
   * resté au carnet 826 secondes, position ouverte et sans protection. Un limite du mauvais côté
   * n'est pas dit ici : `isLimitSideInvalid` le bloque déjà.
   */
  stopLimitWarning = computed(() => {
    const input = {
      orderKind: this.orderKind(),
      tpsl: this.tpsl(),
      isMarket: this.isMarket(),
      isBuy: this.isBuy(),
      limitPx: this.limitPx(),
      triggerPx: this.triggerPx(),
    };
    if (!isStopLimitTight(input)) return null;
    const spread = stopLimitSpread(input);
    if (spread === null || spread < 0) return null;
    return `Limit is only ${(spread * 100).toFixed(2)}% from the trigger: this stop may trigger without filling and leave the position open.`;
  });

  /**
   * La position ouverte sur la paire, pour les garde-fous, quel que soit le type d'ordre.
   * `activePosition` ne convient pas : elle n'est lue que pour un déclencheur, et sa lecture
   * PRÉRÈGLE la taille et le sens de clôture. Sans celle-ci, un achat qui réduisait un short
   * passait pour une ouverture, et G3 l'avertissait d'une marge qu'il ne demandait pas (mesuré le
   * 2026-11-12 : short ETH 0,0343, achat de 0,006 annoncé « Needs ≈ 4.04 $ of margin »).
   */
  heldPosition = signal<OpenPosition | null>(null);

  /**
   * Les garde-fous (`order-guards.util.ts`) : des ordres valides, mais probablement pas voulus.
   * Dits, jamais bloqués — `isFormInvalid` ne les lit pas. `info` : ce que l'ordre fera, sans
   * surprise ; `warning` : ce qui en serait une.
   */
  guardNotices = computed(() => {
    const notices: { tone: 'info' | 'warning'; text: string }[] = [];
    if (this.isModify()) return notices;
    const sz = parseFloat(this.sz());
    const isBuy = this.isBuy();
    const reduceOnly = this.reduceOnly();
    const position = this.heldPosition();

    const crossing = crossingCloseLimitWarning({
      orderKind: this.orderKind(),
      reduceOnly,
      isBuy,
      limitPx: this.limitPx(),
      currentPrice: this.currentPrice(),
    });
    if (crossing) notices.push({ tone: 'warning', text: crossing });

    // Un déclencheur ici est un TP/SL reduce-only : il ne retourne rien.
    if (this.orderKind() !== 'trigger') {
      const effect = positionEffect({
        position,
        isBuy,
        sz,
        reduceOnly,
        usesBuySell: this.usesBuySell(),
      });
      if (effect) {
        notices.push({ tone: effect.kind === 'flips' ? 'warning' : 'info', text: effect.text });
      }

      const opening = openingSize({ position, isBuy, sz, reduceOnly });
      const usd = this.sizeUsd();
      const shortfall = marginShortfallWarning({
        openingSz: opening,
        freedSz: position && position.isBuy !== isBuy && opening > 0 ? position.sz : 0,
        price: usd !== null && sz > 0 ? usd / sz : null,
        leverage: this.isPerpCoin() ? (this.leverage()?.value ?? null) : null,
        available: this.capitalAmount(),
      });
      if (shortfall) notices.push({ tone: 'warning', text: shortfall });
    }

    if (this.orderKind() === 'market') {
      const slippage = wideSlippageWarning(Number(this.slippageInput()));
      if (slippage && !this.isSlippageInvalid()) notices.push({ tone: 'warning', text: slippage });
    }
    return notices;
  });

  isFormInvalid = computed(() => {
    if (blocksPlacement(this.marketData())) return true;
    if (blocksOnMarketMeta(this.marketMeta())) return true;
    const order = this.buildOrderDetails();
    if (!order.assetName || !order.sz) return true;
    if (!this.pricesReady()) return true;
    if (parseFloat(order.sz) <= 0) return true;
    if (this.orderKind() === 'market') {
      if (!this.isPerpCoin() || this.isSlippageInvalid()) return true;
      if (this.marketLocked() || this.checkingPosition()) return true;
    }
    return this.isPriceInvalid() || this.isLimitSideInvalid() || this.isSizeInvalid();
  });

  isSpot = computed(() => isSpotMarket(this.selectedCoin() ?? ''));

  /**
   * Long / Short est le vocabulaire d'un perp ; spot, outcome et nom douteux se disent Buy / Sell (voir
   * `orderSideLabel`). Sans actif choisi, le libellé par défaut reste Long / Short.
   */
  usesBuySell = computed(() => {
    const coin = this.selectedCoin();
    return !!coin && !isPerpMarket(coin);
  });

  // Champs du formulaire
  selectedCoin = signal('');
  isBuy = signal(true);
  limitPx = signal('');
  sz = signal('');
  reduceOnly = signal(false);
  tif = signal<HLTif>('Alo');
  orderKind = signal<OrderKind>('limit');
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

  previousKind = signal<OrderKind>(this.orderKind());

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
      // Une fermeture préparée porte la taille de la position : la taille par défaut ne l'écrase pas.
      if (this.closePreset) return;
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
          const preset = this.closePreset;
          this.sz.set(preset && preset.coin === coin ? preset.sz : '');
        }
        // L'ordre au marché ne vaut que pour un perp : un spot repasse en limite.
        if (this.orderKind() === 'market' && coin && !isPerpMarket(coin)) {
          this.orderKind.set('limit');
        }
        this.activePosition.set(null);
        this.heldPosition.set(null);
        // Le prix, le levier et l'état de marché étaient ceux de l'actif PRÉCÉDENT
        // jusqu'à la réponse suivante — et restaient tels quels si elle échouait
        // (le prix de BTC sous un ETH choisi, mesuré le 2026-10-16).
        this.currentPrice.set(null);
        this.leverage.set(null);
        this.marketData.set('none');
        // La levée du levier de l'actif PRÉCÉDENT : `maxLeverage` n'était pas remis à zéro.
        this.maxLeverage.set(null);
        if (!coin) {
          this.marketMeta.set('none');
          this.marketMetaDetail.set(null);
          return;
        }
        this.loadMarketMeta(coin);
        this.loadHeldPosition(coin);
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
        // Le sens ne bascule qu'en entrant dans un déclencheur ou en en sortant : un déclencheur
        // ferme, un limite ou un marché ouvre. Passer de limite à marché garde le sens choisi.
        const crossesTrigger = (kind === 'trigger') !== (this.previousKind() === 'trigger');
        this.previousKind.set(kind);
        this.reduceOnly.set(kind === 'trigger' || this.closePreset !== null);
        if (kindChanged) {
          if (crossesTrigger) this.isBuy.set(!isBuy);
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
      const preset = this.closePreset;
      const coin = preset?.coin ?? this.defaultCoin;
      if (preset) {
        // Le sens de clôture et la taille de la position, en reduce-only : l'effet du changement
        // d'actif reprend la taille du préréglage au lieu de vider le champ.
        this.isBuy.set(preset.isBuy);
        this.reduceOnly.set(true);
      }
      if (coin) {
        this.selectedCoin.set(coin);
        this.hlMarket.resolveCoin(coin).subscribe((name) => this.coinTitle.set(name));
      }
      this.marketOrders.loadMaxSlippage().then(() => {
        this.slippageInput.set(String(this.marketOrders.maxSlippagePct()));
      });
    }
  }

  /** Saisie du glissement maximal : mémorisé dès qu'il est valide. */
  onSlippageInput(value: string): void {
    this.slippageInput.set(value);
    const pct = Number(value);
    if (isValidMaxSlippage(pct)) this.marketOrders.setMaxSlippage(pct);
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

    // `activeAssetData` est une requête de perps : l'API répond 500 pour un actif spot (mesuré sur
    // `PURR/USDC`) et pour un outcome (mesuré sur `#10` le 2026-10-20, HTTP 500). Seul un perp la reçoit ;
    // tout autre marché — spot, outcome, nom douteux — dit que le contrôle de prix n'existe pas pour lui. On
    // n'envoie pas une requête qui échoue à coup sûr, pour rien, sur le poids d'IP, et qui ferait afficher un
    // bouton « Retry » dont la réponse ne changera jamais.
    if (!isPerpMarket(selectedCoin)) {
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

  /**
   * Lit la grille du marché choisi. Une réponse qui arrive après un changement d'actif est ignorée : sans
   * cette garde, la grille du marché PRÉCÉDENT écrasait celle du nouveau (même défaut que `szDecimals`
   * resté sur l'actif d'avant, mesuré le 2026-10-16).
   */
  private loadMarketMeta(coin: string): void {
    this.marketMeta.set('loading');
    this.marketMetaDetail.set(null);

    this.hlMarket.getMarketMeta(coin).subscribe({
      next: (meta) => {
        if (this.selectedCoin() !== coin) return;
        this.szDecimals.set(meta.szDecimals);
        this.maxLeverage.set(meta.kind === 'perp' ? meta.maxLeverage : null);
        this.szDecimalsKnown.set(true);
        this.marketMeta.set('ok');
      },
      error: (error: unknown) => {
        if (this.selectedCoin() !== coin) return;
        // La grille est celle du marché, ou rien : une lecture qui échoue — même sur le marché dont la
        // précédente avait réussi — n'en laisse pas le levier ni le « connue » derrière elle (le texte
        // « 5x / 5x » restait affiché sous un bandeau qui disait la grille illisible).
        this.maxLeverage.set(null);
        this.szDecimalsKnown.set(false);
        this.marketMeta.set(marketMetaStateOf(error));
        this.marketMetaDetail.set(marketMetaDetailOf(error));
      },
    });
  }

  /** Relance la lecture de la grille : le même appel que le changement d'actif. */
  retryMarketMeta(): void {
    const coin = this.selectedCoin();
    if (coin) this.loadMarketMeta(coin);
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

  /**
   * La position de la paire pour les garde-fous : une lecture par changement de paire (poids 2),
   * sans rien prérégler. Une lecture en échec laisse `null` : les garde-fous qui en dépendent se
   * taisent, ils n'inventent pas une position.
   */
  private loadHeldPosition(coin: string): void {
    const dex = hlPerpDexOf(coin);
    if (this.isModify() || dex === null) return;
    this.hlInfo.getClearinghouseState(dex).subscribe({
      next: (state) => {
        // La réponse d'une paire précédente n'écrase pas celle de la paire choisie depuis.
        if (this.selectedCoin() !== coin) return;
        const position = state.assetPositions.find((ap) => ap.position?.coin === coin)?.position;
        const szi = position ? Number(position.szi) : 0;
        this.heldPosition.set(szi ? { isBuy: szi > 0, sz: Math.abs(szi) } : null);
      },
      error: () => this.heldPosition.set(null),
    });
  }

  private loadActivePosition(): void {
    const coin = this.selectedCoin();
    if (!coin || this.isModify() || this.orderKind() !== 'trigger') {
      this.activePosition.set(null);
      return;
    }

    // Un non-perp (spot, nom douteux) n'a pas de position à lire : `hlPerpDexOf` rend `null`, et le dex
    // principal n'est pas un repli — c'est lui qu'`extractDex` rendait pour un spot.
    const dex = hlPerpDexOf(coin);
    if (dex === null) {
      this.activePosition.set(null);
      return;
    }
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
        mainLimitPx: this.protectiveRefPx(),
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
    // Un ordre au marché exécuté a changé le compte : l'appelant doit relire, même si on ferme ici.
    this.modalCtrl.dismiss(null, this.marketLocked() ? 'confirm' : 'cancel');
  }

  getProtectiveTriggerPx(p: ProtectiveOrderResult): string {
    return computeProtectiveTriggerPx(
      {
        isBuy: this.isBuy(),
        limitPx: this.protectiveRefPx(),
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

  /**
   * Pose les protections en un seul envoi, et rend celles qui n'ont PAS été posées, avec la raison.
   * L'ordre limite les ignore (il ferme le formulaire comme avant, les toasts disent l'échec) ;
   * l'ordre au marché, lui, ne se ferme pas sur une position exécutée sans protection.
   */
  private submitProtectiveOrders$(
    mainContext: UnprotectedFill['context'],
    items: ProtectiveOrderResult[] = this.protectiveOrders(),
  ): Observable<{ failed: ProtectiveOrderResult[]; message: string | null }> {
    if (items.length === 0) return of({ failed: [], message: null });

    const orders = items.map((p) => buildProtectiveOrderDetails(mainContext, p));
    const labels = items.map((p) => p.label);

    return this.hlGateway.placeOrders(orders).pipe(
      map((res) => {
        const refusal = exchangeRefusal(res);
        if (refusal) {
          labels.forEach((label) => this.presentToast(`${label} failed: ${refusal}`, 'danger'));
          return { failed: items, message: `${refusal} None was placed.` };
        }
        const statuses: HLPlaceOrderStatus[] = res?.response?.data?.statuses ?? [];
        labels.forEach((label, i) => this.showOrderStatusToast(statuses[i], label));
        this.availableCapitalService.invalidate();
        const failed = items.filter((_, i) => !statuses[i] || !!statuses[i].error);
        const reasons = items
          .map((p, i) =>
            failed.includes(p) ? `${p.label}: ${statuses[i]?.error ?? 'no status'}` : null,
          )
          .filter((r): r is string => r !== null);
        return { failed, message: failed.length ? reasons.join(' · ') : null };
      }),
      catchError((err: HttpErrorResponse) => {
        const message = extractErrorMessage(err);
        labels.forEach((label) => this.presentToast(`${label} failed: ${message}`, 'danger'));
        // Un réseau coupé ou un 5xx ne dit pas si les protections sont posées : on le dit.
        const uncertain = err.status === 0 || err.status >= 500;
        return of({
          failed: items,
          message: uncertain
            ? `${message} They may have been placed: check the open orders before retrying.`
            : message,
        });
      }),
    );
  }

  buildOrderDetails(): HLOrderDetails {
    const szDec = this.szDecimals();

    // Un ordre au marché ne part pas d'ici (voir `submitMarket`) : ce qui suit ne sert alors qu'aux
    // contrôles du formulaire, actif et taille.
    const orderType =
      this.orderKind() === 'limit'
        ? { limit: { tif: this.tif() } }
        : this.orderKind() === 'market'
          ? { limit: { tif: 'Ioc' as HLTif } }
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

    // Même raison : `submit()` est public, et la grille arrondit ce qui part.
    if (blocksOnMarketMeta(this.marketMeta())) {
      this.error.set(
        this.marketMetaMessage() ?? 'The market grid is still loading: try again in a moment.',
      );
      return;
    }

    if (this.orderKind() === 'market' && !this.isModify()) {
      void this.submitMarket();
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
          // Un `ok` sans `data.statuses` reste un succès (la réponse d'un
          // `modify` n'en porte pas forcément). Mais un `ok` peut aussi porter
          // un refus par ordre, `statuses[0].error` : c'est la forme mesurée le
          // 2026-11-09 pour le même refus dans un lot (`modifyRefusal`).
          const refusal = modifyRefusal(res);
          if (refusal === null && res?.status === 'ok') {
            this.presentToast('Order updated', 'success');
            this.availableCapitalService.invalidate();
            this.modalCtrl.dismiss(null, 'confirm');
          } else {
            // Mesuré le 2026-10-27 et le 2026-11-09 : un `modify` refusé a
            // **annulé** l'ordre d'origine (« Error placing new order during
            // modify »), pour un croisement comme pour un montant sous le
            // minimum. Pas toujours (un agent inconnu est refusé avant tout) :
            // on le dit comme une possibilité, à vérifier.
            this.error.set(
              `${asSentence(refusal ?? 'Failed to update order: unexpected reply.')} Check the open orders: the original may have been cancelled.`,
            );
            this.availableCapitalService.invalidate();
          }
          return;
        }

        // Refus d'ensemble : rien n'a été posé, donc aucun ordre de protection
        // ne doit suivre. Avant, « no response » s'affichait et les protections
        // partaient quand même.
        const refusal = exchangeRefusal(res);
        if (refusal) {
          this.error.set(refusal);
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

  // ── Ordre au marché ────────────────────────────────────────────────────────

  /**
   * L'ordre au marché : la confirmation (toujours), puis UN envoi, puis les protections sur ce qui
   * a été rempli. Aucune étape n'est relancée d'elle-même.
   */
  private async submitMarket(): Promise<void> {
    const coin = this.selectedCoin();
    if (!coin || !this.isPerpCoin()) {
      this.error.set('A market order is only available on a perp market.');
      return;
    }
    if (this.isSlippageInvalid()) {
      this.error.set(
        `The max slippage must be between ${MIN_MAX_SLIPPAGE_PCT} % and ${MAX_MAX_SLIPPAGE_PCT} %.`,
      );
      return;
    }
    if (this.marketLocked() || this.checkingPosition()) return;
    const szDecimals = this.szDecimals();
    const sz = roundSize(parseFloat(this.sz()), szDecimals);
    if (!(parseFloat(sz) > 0)) {
      this.error.set('Please fill in the size.');
      return;
    }
    if (this.isSizeInvalid()) {
      this.error.set('Hyperliquid refuses an order under 10 $.');
      return;
    }

    const isBuy = this.isBuy();
    const reduceOnly = this.reduceOnly();
    const actionLabel = this.sideLabel(isBuy);

    // La position, relue au moment de confirmer : le prix de liquidation en dépend (« not
    // estimated » s'il y en a une), et la confirmation dit ce que l'ordre lui fera (G2). Relue ici
    // plutôt que prise de `heldPosition`, lue au choix de la paire : elle a pu changer depuis.
    // `undefined` : la lecture a échoué.
    const szi = await new Promise<number | null | undefined>((resolve) => {
      this.marketOrders.readPositionSize(coin).subscribe({
        next: (value) => resolve(value),
        error: () => resolve(undefined),
      });
    });
    const hasPosition = szi === undefined ? null : szi !== null;
    const effect = positionEffect({
      position: szi ? { isBuy: szi > 0, sz: Math.abs(szi) } : null,
      isBuy,
      sz: parseFloat(sz),
      reduceOnly,
      usesBuySell: this.usesBuySell(),
    });

    const modal = await this.modalCtrl.create({
      component: MarketOrderConfirmComponent,
      componentProps: {
        coin: () => coin,
        coinTitle: () => (this.coinTitle() !== '—' ? this.coinTitle() : coin),
        isBuy: () => isBuy,
        sz: () => sz,
        szDecimals: () => szDecimals,
        reduceOnly: () => reduceOnly,
        purpose: () => (reduceOnly ? 'close' : 'open'),
        actionLabel: () => actionLabel,
        leverage: () => this.leverage(),
        hasPosition: () => hasPosition,
        positionEffect: () => effect,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<MarketOrderTicket>();
    if (role !== 'confirm' || !data) return;

    this.error.set(null);
    this.marketOutcome.set(null);
    this.submitting.set(true);
    const order = buildMarketOrder({
      assetName: coin,
      isBuy,
      sz,
      worstPx: data.worstPx,
      reduceOnly,
    });
    this.marketOrders.send(order).subscribe((outcome) => {
      this.submitting.set(false);
      this.onMarketOutcome(outcome, { coin, isBuy, szDecimals, reduceOnly });
    });
  }

  /**
   * Le libellé d'une fermeture préparée : « Place Short » pour fermer un long disait l'inverse de ce
   * que fait l'ordre (vu à l'écran le 2026-11-12). Tant que le sens et le reduce-only du préréglage
   * tiennent ; sinon le libellé ordinaire revient.
   */
  closeLabel(): string | null {
    const preset = this.closePreset;
    if (!preset || this.isModify() || !this.reduceOnly() || this.isBuy() !== preset.isBuy)
      return null;
    return preset.isBuy ? 'Close short' : 'Close long';
  }

  /** Le mot du sens : Long / Short pour un perp, Buy / Sell sinon. */
  sideLabel(isBuy: boolean): string {
    if (this.usesBuySell()) return isBuy ? 'Buy' : 'Sell';
    return isBuy ? 'Long' : 'Short';
  }

  private onMarketOutcome(
    outcome: MarketFillOutcome,
    sent: { coin: string; isBuy: boolean; szDecimals: number; reduceOnly: boolean },
  ): void {
    switch (outcome.kind) {
      case 'not-filled':
      case 'refused':
        // Rien n'a été exécuté : le formulaire reste tel quel, on peut corriger et réessayer.
        this.error.set(outcome.message);
        return;

      case 'unknown':
        this.error.set(outcome.message);
        this.availableCapitalService.invalidate();
        this.readPositionAfterUnknown(sent.coin);
        return;

      case 'filled':
      case 'partial': {
        this.marketLocked.set(true);
        this.availableCapitalService.invalidate();
        const partial = outcome.kind === 'partial';
        if (outcome.kind === 'partial') {
          this.marketOutcome.set({
            tone: 'caution',
            text: `Partially filled: ${outcome.totalSz} of ${outcome.requestedSz} @ ${outcome.avgPx}. The rest was cancelled: the book did not hold it within the max slippage.`,
          });
        } else {
          this.presentToast(
            `Market order filled · ${outcome.totalSz} @ ${outcome.avgPx}`,
            'success',
          );
        }

        const items = sent.reduceOnly ? [] : this.protectiveOrders();
        if (items.length === 0) {
          if (!partial) this.modalCtrl.dismiss(null, 'confirm');
          return;
        }
        // Les protections portent sur ce qui a été rempli, au prix moyen obtenu.
        const context: UnprotectedFill['context'] = {
          assetName: sent.coin,
          isBuy: sent.isBuy,
          limitPx: outcome.avgPx,
          sz: outcome.totalSz,
          szDecimals: sent.szDecimals,
          isSpot: false,
        };
        this.placeProtectionsAfterFill(context, items, !partial);
        return;
      }
    }
  }

  /** Pose les protections après une exécution ; ne ferme le formulaire que si tout est posé. */
  private placeProtectionsAfterFill(
    context: UnprotectedFill['context'],
    items: ProtectiveOrderResult[],
    closeWhenDone: boolean,
  ): void {
    this.retryingProtection.set(true);
    this.submitProtectiveOrders$(context, items).subscribe(({ failed, message }) => {
      this.retryingProtection.set(false);
      if (failed.length === 0) {
        this.unprotected.set(null);
        if (closeWhenDone) this.modalCtrl.dismiss(null, 'confirm');
        return;
      }
      this.unprotected.set({ context, items: failed, message: message ?? 'Not placed.' });
    });
  }

  /** « Retry protection » : seulement celles qui manquent, une fois par appui. */
  retryProtection(): void {
    const pending = this.unprotected();
    if (!pending || this.retryingProtection()) return;
    this.placeProtectionsAfterFill(pending.context, pending.items, this.marketOutcome() === null);
  }

  /** Après un état inconnu : la position relue UNE fois, et montrée. Jamais de relance d'ordre. */
  private readPositionAfterUnknown(coin: string): void {
    this.checkingPosition.set(true);
    this.marketOrders.readPositionSize(coin).subscribe({
      next: (szi) => {
        this.checkingPosition.set(false);
        this.marketOutcome.set({
          tone: 'caution',
          text:
            szi === null
              ? `Position re-read: no open position on ${coin}.`
              : `Position re-read: ${szi > 0 ? 'long' : 'short'} ${Math.abs(szi)} on ${coin}. Compare with what you had before sending again.`,
        });
      },
      error: (error: unknown) => {
        this.checkingPosition.set(false);
        this.marketOutcome.set({
          tone: 'high',
          text: `The position could not be re-read (${extractErrorMessage(error as Error)}): check it on Hyperliquid before sending again.`,
        });
      },
    });
  }
}
