import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
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
  type HLOid,
  type HLPerpPositionDetail,
} from '@syldel/hl-shared-types';
import { extractErrorMessage } from '@utils/hl-error.utils';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import {
  ordinaryProtections,
  positionProtection,
} from '../../perp-summary/position-protection.util';
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
import { trailingCoverage } from '../trailing-stop-coverage.util';
import { isTrailingStop, trailingStopSummary, trailingStopView } from '../trailing-stop-view.util';
import {
  readCancelReply,
  stopChange,
  trailingPrefill,
  type TrailingReplaced,
} from '../trailing-stop-replace.util';

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
 * **En remplacement** (`replacingOid`, étape 4) : la feuille reprend les valeurs de l'ancien, dit ce que le
 * remplacement fait au stop (`stopChange` : le suivi repart du marqué du moment), pose le nouveau, puis
 * annule l'ancien — jamais dans l'autre ordre, et jamais l'ancien après une pose à l'issue inconnue
 * (`trailing-stop-replace.util.ts`). Une annulation qui échoue laisse deux trailings : l'écran le dit, et
 * propose de la retenter (annuler se renvoie sans risque, poser non).
 *
 * **Plusieurs trailings par position sont voulus** (sortie en paliers) : la couverture cumulée se dit
 * (`trailingCoverage`), « Rest » remplit la part sans trailing, et chaque trailing listé se remplace d'ici —
 * au premier essai réel (2026-11-19), « Trail » depuis la carte a ajouté un 8 % à côté du 10 % qu'on voulait
 * remplacer, faute de chemin vers le remplacement depuis cet écran.
 *
 * **Un stop-loss ordinaire se remplace aussi** par un trailing (2026-11-19), par le même circuit : poser,
 * puis annuler. Comme l'interface d'Hyperliquid, qui n'attache pas de trailing à un ordre d'entrée mais le
 * pose pour lui-même : c'est ici qu'on décide de passer du stop fixe au stop suiveur. Jamais le stop du bot.
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
  /**
   * La paire est au bot ; `null` : le profil n'a pas pu être lu, et l'écran le dit ; `undefined` : l'appelant
   * ne l'a pas demandé (le détail d'un ordre), rien n'est dit du bot.
   */
  readonly botManaged = input<boolean | null | undefined>(undefined);
  /** L'oid du trailing à remplacer ; `null` : une pose simple. */
  readonly replacingOid = input<HLOid | null>(null);
  /**
   * Le trailing remplacé **maintenant** : l'entrée au départ, puis le choix fait dans la liste (« Replace »,
   * « Add a new one instead »).
   */
  readonly target = linkedSignal(() => this.replacingOid());

  readonly percents = CLOSE_PERCENTS;

  readonly market = signal<{ szDecimals: number; markPx: string } | null>(null);
  readonly marketError = signal<string | null>(null);
  readonly orders = signal<HLFrontendOpenOrder[] | null>(null);
  readonly ordersError = signal<string | null>(null);

  readonly percent = signal<number | 'rest' | null>(100);
  readonly sz = signal('');
  readonly unit = signal<TrailingUnit>('pct');
  readonly retracement = signal('');
  readonly activation = signal('');

  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly outcome = signal<{ tone: 'caution' | 'high'; text: string } | null>(null);
  /** Une issue inconnue, ou un remplaçant posé : on ne pose plus rien depuis cette feuille. */
  readonly locked = signal(false);
  /** Le remplaçant posé, et l'actif signé : de quoi annuler l'ancien, ou le retenter. */
  private readonly placed = signal<{ oid: number; asset: number } | null>(null);
  /** L'annulation de l'ancien a échoué : deux trailings protègent la position. */
  readonly oldCancelFailed = signal(false);
  readonly cancellingOld = signal(false);
  private prefilled = false;
  /** La taille par défaut d'une pose simple a été choisie : une fois, marché et ordres lus. */
  private sized = false;

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
      .map((o) => ({
        oid: o.oid,
        text: trailingStopSummary(trailingStopView(o)!),
        replaced: o.oid === this.target(),
      })),
  );

  /**
   * Les stops et take-profits ordinaires de la position. Seul un stop-loss se remplace par un trailing, et
   * seulement sur une paire que le bot ne gère pas (`botManaged === false`) : le trailing s'ajoute au stop
   * du bot, jamais à sa place (décidé le 2026-11-16). Profil illisible ou non demandé : on ne sait pas
   * qui l'a posé, il ne se remplace pas d'ici.
   */
  readonly stops = computed(() => {
    const orders = this.orders();
    if (orders === null) return [];
    const bot = this.botManaged() === true;
    return ordinaryProtections(this.position(), orders).map((p) => ({
      ...p,
      text: `${p.role} ${p.px} · ${p.orderType} · ${p.wholePosition ? 'whole position' : p.sz}${bot ? ' · bot' : ''}`,
      replaceable: p.role === 'SL' && this.botManaged() === false,
      replaced: p.oid === this.target(),
    }));
  });

  /** Le stop-loss ordinaire en cours de remplacement, ou `null` (un trailing, ou une pose simple). */
  readonly replacingStop = computed(() => this.stops().find((s) => s.replaced) ?? null);

  /** Ce qui est remplacé, en mots, pour les textes. */
  readonly replacedLabel = computed(() => (this.replacingStop() ? 'stop loss' : 'trailing stop'));

  /** L'ancien, tel que la liste le donne **maintenant** : son état courant, pas celui de sa pose. */
  readonly replacing = computed(() => {
    const oid = this.target();
    return oid === null ? null : (this.orders()?.find((o) => o.oid === oid) ?? null);
  });

  /** L'ancien n'est plus dans la liste : déclenché ou annulé entre-temps. Rien à remplacer. */
  readonly replacingMissing = computed(
    () => this.target() !== null && this.orders() !== null && this.replacing() === null,
  );

  readonly change = computed(() => {
    const plan = this.plan();
    const old = this.replacing();
    if (!plan || !old) return null;
    const stop = this.replacingStop();
    return stopChange(stop ? { state: 'fixed', stopPx: stop.px } : trailingStopView(old), plan);
  });

  /** Ce que les trailings de la paire couvrent de la position, l'ancien exclu en remplacement. */
  readonly coverage = computed(() => {
    const market = this.market();
    const orders = this.orders();
    if (!market || orders === null) return null;
    return trailingCoverage({
      positionSzi: this.position().szi,
      szDecimals: market.szDecimals,
      trailings: orders
        .filter((o) => o.coin === this.coin() && isTrailingStop(o))
        .map((o) => ({ oid: o.oid, sz: o.sz })),
      excludeOid: this.target(),
      newSz: this.sz(),
    });
  });

  /** La part de la position sans trailing ; `''` : rien à compléter. */
  readonly rest = computed(() => {
    const c = this.coverage();
    return c?.kind === 'read' ? c.rest : '';
  });

  readonly canReview = computed(
    () =>
      this.plan() !== null &&
      !this.sending() &&
      !this.locked() &&
      this.orders() !== null &&
      !this.replacingMissing(),
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
        this.applyDefaultSize();
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

  /** « Rest » : la part de la position que les autres trailings laissent sans trailing. */
  selectRest(): void {
    const rest = this.rest();
    if (!rest) return;
    this.percent.set('rest');
    this.sz.set(rest);
  }

  /** « Replace » sur un trailing listé : la feuille passe en remplacement de celui-là, pré-remplie. */
  replaceOne(oid: HLOid): void {
    if (this.locked() || this.sending()) return;
    // Public : le refus ne dépend pas du seul bouton. Un stop du bot ou un take-profit ne se remplace pas.
    const allowed =
      this.existing().some((e) => e.oid === oid) ||
      this.stops().some((s) => s.oid === oid && s.replaceable);
    if (!allowed) return;
    this.error.set(null);
    this.target.set(oid);
    this.prefilled = false;
    this.applyPrefill();
  }

  /** Retour à une pose simple : la taille repart du défaut, le repli saisi reste. */
  addInstead(): void {
    if (this.locked() || this.sending()) return;
    this.error.set(null);
    this.target.set(null);
    this.sized = false;
    this.applyDefaultSize();
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
    const replacing = this.target();
    const change = this.change();
    const alert = await this.alertCtrl.create({
      header: replacing === null ? 'Place trailing stop' : `Replace ${this.replacedLabel()}`,
      message:
        `${this.orderSide()} ${plan.body.sz} ${this.coin()}, reduce-only · retracement ${retracement} · ` +
        (plan.activation
          ? `waits ${plan.activation.direction} ${plan.activation.px}`
          : 'tracks from now') +
        ` · stop starts ≈ ${formatStop(plan.stopAtStart)}` +
        (replacing === null
          ? ''
          : ` · then OID ${replacing} is cancelled. ${change ? change.text : ''}`),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: replacing === null ? 'Place' : 'Replace', role: 'confirm' },
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
      next: ({ oid, action }) => {
        this.sending.set(false);
        if (this.target() === null) {
          this.orderToast.success(`Trailing stop placed · OID ${oid}`);
          this.modalCtrl.dismiss(null, 'confirm');
          return;
        }
        // Le remplaçant protège : l'ancien peut partir. L'actif est celui que le gateway a signé.
        this.locked.set(true);
        this.placed.set({ oid, asset: action.asset });
        this.cancelOld();
      },
      error: (error: HttpErrorResponse) => {
        this.sending.set(false);
        const message = extractErrorMessage(error);
        if (trailingSendFailure(error.status, error.error) === 'nothing-placed') {
          this.error.set(message);
          return;
        }
        // Peut-être posé : ni renvoi, ni second bouton. On relit, une fois, et on montre. En remplacement,
        // l'ancien n'est PAS annulé : deux trailings valent mieux que zéro.
        this.locked.set(true);
        this.error.set(
          `${message} It may have been placed: nothing will be sent again from here` +
            (this.target() === null ? '.' : ', and the old trailing stop is kept.'),
        );
        this.rereadAfterUnknown();
      },
    });
  }

  /**
   * Annule l'ancien, après la pose du remplaçant. Se retente sans risque : un second `cancel` du même oid
   * échoue sans rien changer.
   */
  cancelOld(): void {
    const placed = this.placed();
    const old = this.target();
    if (!placed || old === null || this.cancellingOld()) return;
    this.cancellingOld.set(true);
    this.oldCancelFailed.set(false);
    const twoStops = (why: string) => {
      this.oldCancelFailed.set(true);
      this.outcome.set({
        tone: 'high',
        text: `Two stops now protect this position: the new trailing stop (OID ${placed.oid}) and the old ${this.replacedLabel()} (OID ${old}), whose cancel failed: ${why}`,
      });
    };
    this.gateway.cancelOrder([{ asset: placed.asset, oid: old }]).subscribe({
      next: (reply) => {
        this.cancellingOld.set(false);
        const read = readCancelReply(reply);
        switch (read.kind) {
          case 'cancelled':
            this.orderToast.success(`Replaced · OID ${placed.oid} (OID ${old} cancelled)`);
            this.modalCtrl.dismiss(
              { kind: 'replaced', newOid: placed.oid, oldOid: old } satisfies TrailingReplaced,
              'confirm',
            );
            return;
          case 'gone':
            this.outcome.set({
              tone: 'caution',
              text: `The new trailing stop is placed (OID ${placed.oid}), but the old one was no longer open (${read.message}): it may have triggered. Check the position.`,
            });
            return;
          case 'refused':
            twoStops(read.message);
            return;
          case 'unknown':
            twoStops('the reply did not say.');
            return;
        }
      },
      error: (error: HttpErrorResponse) => {
        this.cancellingOld.set(false);
        twoStops(extractErrorMessage(error));
      },
    });
  }

  /**
   * Pose simple : le reste quand d'autres trailings couvrent déjà une part (le palier suivant), 100 % sinon.
   * En remplacement, la taille vient de l'ancien (`applyPrefill`).
   */
  private applyDefaultSize(): void {
    if (this.sized || this.target() !== null || !this.market() || this.orders() === null) return;
    this.sized = true;
    if (this.rest() && this.coverage() !== null) this.selectRest();
    else this.selectPercent(100);
  }

  /** Reprend les valeurs de l'ancien, une fois, dès qu'il est lu dans la liste. */
  private applyPrefill(): void {
    const old = this.replacing();
    if (this.prefilled || !old) return;
    this.prefilled = true;
    // Un stop-loss remplacé : sa taille seulement. Le repli n'a pas d'équivalent dans un seuil fixe.
    const stop = this.replacingStop();
    if (stop) {
      const sz = stop.wholePosition ? String(this.positionSz()) : stop.sz;
      this.sz.set(sz);
      this.percent.set(Number(sz) === this.positionSz() ? 100 : null);
      return;
    }
    const prefill = trailingPrefill(old);
    if (!prefill) return;
    this.sz.set(prefill.sz);
    this.percent.set(Number(prefill.sz) === this.positionSz() ? 100 : null);
    this.unit.set(prefill.unit);
    this.retracement.set(prefill.value);
    this.activation.set(prefill.activation);
  }

  private readOrders(): void {
    const dex = hlPerpDexOf(this.coin()) ?? '';
    this.hlInfo.getFrontendOpenOrders(dex || undefined).subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.applyPrefill();
        this.applyDefaultSize();
      },
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
    // Une issue inconnue, ou un remplaçant posé, a changé le compte : l'appelant relit.
    this.modalCtrl.dismiss(null, this.locked() ? 'confirm' : 'cancel');
  }
}
