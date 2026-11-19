import { HttpErrorResponse } from '@angular/common/http';
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
  AlertController,
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
} from '@ionic/angular/standalone';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { OrderToastService } from '@services/order-toast.service';
import {
  hlPerpDexOf,
  type HLFrontendOpenOrder,
  type HLPerpPositionDetail,
} from '@syldel/hl-shared-types';
import { extractErrorMessage } from '@utils/hl-error.utils';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { positionProtection } from '../../perp-summary/position-protection.util';
import { CLOSE_PERCENTS, closeSize } from '../market-order/close-position.util';
import {
  botStopNotice,
  formatStop,
  planTrailingEntry,
  readTrailingMarket,
  trailingSendFailure,
  type TrailingEntryField,
  type TrailingEntryPlan,
  type TrailingUnit,
} from '../trailing-stop-entry.util';
import { isTrailingStop, trailingStopSummary, trailingStopView } from '../trailing-stop-view.util';

/**
 * ============================================================================
 * « Trail » depuis la carte d'une position : un trailing stop natif d'Hyperliquid, reduce-only, du côté qui
 * ferme la position (étape 3 du chantier, `docs/roadmap.md`). Il s'ajoute au stop du bot, il ne le remplace
 * jamais.
 *
 * Ce que l'écran garantit :
 *
 * - **la saisie se contrôle avant l'envoi**, champ par champ, par `planTrailingEntry` (grille, côté de
 *   l'activation, repli sous 100 %), sur le marqué et la grille lus à l'ouverture dans `metaAndAssetCtxs` du
 *   dex de la paire (poids 20). Le gateway refait le contrôle de l'activation sur son propre marqué : il fait
 *   autorité ;
 * - **ce qui part se dit avant de partir** : le stop au départ du suivi, sa valeur au déclenchement, et sur
 *   une paire du bot, s'il sortirait avant le stop du bot (`botStopNotice`) ;
 * - **les trailings déjà posés sur la paire s'affichent** : en poser un second par erreur ne se verrait pas
 *   ailleurs avant la relecture ;
 * - **jamais de second envoi après une issue inconnue** (`trailingSendFailure`) : l'action n'a pas de `cloid`.
 *   L'écran se verrouille et relit les ordres ouverts une fois.
 *
 * Les champs restent ceux de l'API, unités écrites : un pourcentage n'est pas une distance en prix, et une
 * saisie prise pour l'autre a été refusée par l'exchange pendant la mesure (2026-11-17).
 * ============================================================================
 */
@Component({
  selector: 'app-trailing-stop-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  templateUrl: './trailing-stop-form.component.html',
  styleUrls: ['./trailing-stop-form.component.scss'],
})
export class TrailingStopFormComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly gateway = inject(HyperliquidGatewayService);
  private readonly orderToast = inject(OrderToastService);

  /** Entrées de modale (`componentProps: { position: () => p }`) : lues, jamais suivies. */
  readonly position = input.required<HLPerpPositionDetail>();
  /** La paire est au bot ; `null` : le profil n'a pas pu être lu, on ne sait pas. */
  readonly botManaged = input<boolean | null>(false);

  readonly percents = CLOSE_PERCENTS;

  readonly market = signal<{ szDecimals: number; markPx: string } | null>(null);
  readonly marketError = signal<string | null>(null);
  readonly orders = signal<HLFrontendOpenOrder[] | null>(null);
  readonly ordersError = signal<string | null>(null);

  readonly percent = signal<number | null>(100);
  readonly sz = signal('');
  readonly unit = signal<TrailingUnit>('pct');
  readonly retracement = signal('');
  readonly activation = signal('');

  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly outcome = signal<{ tone: 'caution' | 'high'; text: string } | null>(null);
  /** Une issue inconnue : on ne renvoie plus rien depuis cette feuille. */
  readonly locked = signal(false);

  readonly coin = computed(() => this.position().coin);
  readonly isLong = computed(() => Number(this.position().szi) > 0);
  readonly positionSz = computed(() => Math.abs(Number(this.position().szi)));
  /** Le côté de l'ordre, celui qui ferme : une vente pour un long. */
  readonly orderSide = computed(() => (this.isLong() ? 'Sell' : 'Buy'));

  readonly entry = computed(() => {
    const market = this.market();
    if (!market) return null;
    return planTrailingEntry({
      coin: this.coin(),
      positionSzi: this.position().szi,
      markPx: market.markPx,
      szDecimals: market.szDecimals,
      sz: this.sz(),
      retracement: { unit: this.unit(), value: this.retracement() },
      activationPx: this.activation(),
    });
  });

  readonly plan = computed((): TrailingEntryPlan | null => {
    const entry = this.entry();
    return entry?.ok ? entry.plan : null;
  });

  readonly warnings = computed(() => {
    const entry = this.entry();
    return entry?.ok ? entry.warnings : [];
  });

  /** Ce que le départ du suivi donnerait, en une phrase. */
  readonly preview = computed(() => {
    const plan = this.plan();
    if (!plan) return null;
    const stop = formatStop(plan.stopAtStart);
    const value = plan.notionalAtStop.toFixed(2);
    return plan.activation
      ? `Waits until the mark goes ${plan.activation.direction} ${plan.activation.px}, then its stop starts at ${stop} (≈ ${value} $ at the stop).`
      : `Tracks from now: its stop starts at ${stop}, from the mark ${this.market()!.markPx} (≈ ${value} $ at the stop).`;
  });

  /** Le stop du bot sur cette position, lu dans les mêmes ordres que la couverture de la carte. */
  readonly botNotice = computed(() => {
    const plan = this.plan();
    const orders = this.orders();
    if (!plan || this.botManaged() !== true || orders === null) return null;
    const protection = positionProtection(this.position(), orders, true);
    if (protection.verdict !== 'read') return null;
    const bot = protection.sl.find((s) => s.source === 'bot')?.coverage;
    const stopPx = bot && bot.state !== 'none' ? bot.nearest.px : null;
    return botStopNotice(plan, { stopPx });
  });

  /** Les trailings déjà posés sur la paire. */
  readonly existing = computed(() =>
    (this.orders() ?? [])
      .filter((o) => o.coin === this.coin() && isTrailingStop(o))
      .map((o) => ({ oid: o.oid, text: trailingStopSummary(trailingStopView(o)!) })),
  );

  readonly canReview = computed(
    () => this.plan() !== null && !this.sending() && !this.locked() && this.orders() !== null,
  );

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit(): void {
    const coin = this.coin();
    const dex = hlPerpDexOf(coin) ?? '';

    this.hlInfo.getMetaAndAssetCtxs(dex).subscribe({
      next: (metaAndCtx) => {
        const read = readTrailingMarket(coin, metaAndCtx);
        if (!read.ok) {
          this.marketError.set(`${read.reason} Nothing can be checked, so nothing can be sent.`);
          return;
        }
        this.market.set({ szDecimals: read.szDecimals, markPx: read.markPx });
        this.selectPercent(100);
      },
      error: (error: unknown) =>
        this.marketError.set(
          `The market of ${coin} could not be read (${extractErrorMessage(error as Error)}): nothing can be sent.`,
        ),
    });

    this.readOrders();
  }

  /** Un champ refusé, en mots ; rien tant que le repli n'a pas été saisi (il est vide à l'ouverture). */
  issue(field: TrailingEntryField): string | null {
    const entry = this.entry();
    if (!entry || entry.ok) return null;
    if (field === 'retracement' && this.retracement().trim() === '') return null;
    const messages = entry.issues.filter((i) => i.field === field).map((i) => i.message);
    return messages.length > 0 ? messages.join(' ') : null;
  }

  selectPercent(percent: number): void {
    const market = this.market();
    if (!market) return;
    this.percent.set(percent);
    this.sz.set(closeSize(this.position().szi, percent, market.szDecimals));
  }

  onSizeInput(value: string): void {
    this.percent.set(null);
    this.sz.set(value);
  }

  async review(): Promise<void> {
    const plan = this.plan();
    if (!plan || !this.canReview()) return;

    const retracement =
      'pct' in plan.body.retracement
        ? `${plan.body.retracement.pct} %`
        : `${plan.body.retracement.px} $`;
    const alert = await this.alertCtrl.create({
      header: 'Place trailing stop',
      message:
        `${this.orderSide()} ${plan.body.sz} ${this.coin()}, reduce-only · retracement ${retracement} · ` +
        (plan.activation
          ? `waits ${plan.activation.direction} ${plan.activation.px}`
          : 'tracks from now') +
        ` · stop starts ≈ ${formatStop(plan.stopAtStart)}`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Place', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;
    this.send(plan);
  }

  private send(plan: TrailingEntryPlan): void {
    this.error.set(null);
    this.outcome.set(null);
    this.sending.set(true);
    this.gateway.placeTrailingStop(plan.body).subscribe({
      next: ({ oid }) => {
        this.sending.set(false);
        this.orderToast.success(`Trailing stop placed · OID ${oid}`);
        this.modalCtrl.dismiss(null, 'confirm');
      },
      error: (error: HttpErrorResponse) => {
        this.sending.set(false);
        const message = extractErrorMessage(error);
        if (trailingSendFailure(error.status, error.error) === 'nothing-placed') {
          this.error.set(message);
          return;
        }
        // Peut-être posé : ni renvoi, ni second bouton. On relit, une fois, et on montre.
        this.locked.set(true);
        this.error.set(`${message} It may have been placed: nothing will be sent again from here.`);
        this.rereadAfterUnknown();
      },
    });
  }

  private readOrders(): void {
    const dex = hlPerpDexOf(this.coin()) ?? '';
    this.hlInfo.getFrontendOpenOrders(dex || undefined).subscribe({
      next: (orders) => this.orders.set(orders),
      error: (error: unknown) =>
        this.ordersError.set(
          `The open orders could not be read (${extractErrorMessage(error as Error)}): the trailing stops already on this pair are unknown, so nothing can be sent.`,
        ),
    });
  }

  /** Après une issue inconnue : les ordres ouverts relus UNE fois, et ce qu'ils disent de la paire. */
  private rereadAfterUnknown(): void {
    const before = new Set(this.existing().map((e) => e.oid));
    const dex = hlPerpDexOf(this.coin()) ?? '';
    this.hlInfo.getFrontendOpenOrders(dex || undefined).subscribe({
      next: (orders) => {
        this.orders.set(orders);
        const added = this.existing().filter((e) => !before.has(e.oid));
        this.outcome.set(
          added.length > 0
            ? {
                tone: 'caution',
                text: `Re-read: it was placed (OID ${added.map((a) => a.oid).join(', ')}).`,
              }
            : {
                tone: 'caution',
                text: 'Re-read: no new trailing stop on this pair. Check Open Orders before trying again.',
              },
        );
      },
      error: (error: unknown) =>
        this.outcome.set({
          tone: 'high',
          text: `The open orders could not be re-read (${extractErrorMessage(error as Error)}): check them before trying again.`,
        }),
    });
  }

  dismiss(): void {
    // Une issue inconnue a pu changer le compte : l'appelant relit.
    this.modalCtrl.dismiss(null, this.locked() ? 'confirm' : 'cancel');
  }
}
