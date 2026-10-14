import { TitleCasePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import {
  IonBadge,
  IonFab,
  IonFabButton,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonItemGroup,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonToggle,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { TradingPair } from '@models/user.interface';
import { BotService } from '@services/bot.service';
import { HyperliquidMarketService } from '@services/hyperliquid-market.service';
import { UserService } from '@services/user.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { extractErrorMessage } from '@utils/hl-error.utils';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { hlPerpDexOf } from '@syldel/hl-shared-types';
import { ExternalUser, IExchange, ProtectiveOrderEntry } from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import {
  addOutline,
  alertCircleOutline,
  pencilOutline,
  shieldCheckmarkOutline,
  trashOutline,
  trendingDownOutline,
  trendingUpOutline,
} from 'ionicons/icons';
import { EMPTY, catchError, debounceTime, firstValueFrom, Subject, switchMap } from 'rxjs';
import {
  ProtectiveModalComponent,
  ProtectiveModalResult,
} from './components/protective-modal/protective-modal.component';
import {
  TradingPairModalComponent,
  TradingPairModalResult,
} from './components/trading-pair-modal/trading-pair-modal.component';
import {
  dexesToLoad,
  dexLabel,
  isKnownUnexecutableMarket,
  pairMarketStatus,
  type PairMarketStatus,
  type PerpMarketCatalogue,
} from './domain/pair-market-status.util';
import { protectiveDistanceLabel } from './domain/protective-distance.util';
import {
  isKnownUnexecutable,
  pairStrategyStatus,
  type PairStrategyStatus,
} from './domain/pair-strategy-status.util';

@Component({
  selector: 'app-bot-strategies',
  standalone: true,
  imports: [
    RefreshableLayoutComponent,
    IonList,
    IonItem,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonLabel,
    IonBadge,
    IonItemGroup,
    IonItemDivider,
    IonToggle,
    IonFab,
    IonFabButton,
    IonIcon,
    TitleCasePipe,
    UpperCasePipe,
  ],
  templateUrl: './bot-strategies.page.html',
  styleUrls: ['./bot-strategies.page.scss'],
})
export class BotStrategiesPage extends MenuBasePage {
  private readonly userService = inject(UserService);
  private readonly modalCtrl = inject(ModalController);
  private readonly botService = inject(BotService);
  private readonly hlMarket = inject(HyperliquidMarketService);
  private readonly toastCtrl = inject(ToastController);

  user = signal<ExternalUser | null>(null);
  fetchFn = () => this.userService.getMe();

  botEntries = computed(() =>
    Object.entries(this.user()?.tradingSettings ?? {}).map(([key, value]) => ({ key, value })),
  );

  private readonly save$ = new Subject<Record<string, IExchange>>();

  readonly exitBehaviorLabels = this.botService.exitBehaviorLabels;
  readonly protectiveDistanceLabel = protectiveDistanceLabel;

  constructor() {
    super();
    addIcons({
      addOutline,
      alertCircleOutline,
      pencilOutline,
      trashOutline,
      shieldCheckmarkOutline,
      trendingUpOutline,
      trendingDownOutline,
    });

    this.botService.getExchangeFormMetadata().subscribe();

    /**
     * ⚠️ Le `catchError` est **à l'intérieur** du `switchMap`, et ce n'est pas
     * une préférence de style : posé sur le flux extérieur, il verrait passer
     * la première erreur puis laisserait l'abonnement se terminer, ce qui est
     * exactement le défaut corrigé ici.
     *
     * Il n'y en avait aucun. Une erreur du `PATCH` remontait donc à l'abonné,
     * terminait la souscription, et **toutes les sauvegardes suivantes étaient
     * ignorées en silence** : l'interrupteur restait allumé à l'écran, le
     * compte n'avait rien reçu, et `ion-router-outlet` gardant la page vivante,
     * quitter l'écran puis revenir ne la ressuscitait pas. Sur l'écran qui arme
     * les paires du bot.
     */
    this.save$
      .pipe(
        debounceTime(1000),
        switchMap((tradingSettings) =>
          this.userService.updateStrategy(tradingSettings).pipe(
            catchError((error: unknown) => {
              void this.announceSaveFailure(extractErrorMessage(error as HttpErrorResponse));
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  // ------------------------------------------------------------------ //
  //  Executability
  // ------------------------------------------------------------------ //

  /**
   * Le bot exécutera-t-il cette paire, et peut-on encore le savoir ?
   *
   * Le catalogue est déjà chargé par le constructeur — il sert aux libellés
   * d'`exitBehavior` — donc l'autorité était à portée de main, elle n'était
   * simplement pas consultée. Tant qu'il n'est pas arrivé, `null` fait rendre
   * `unverified` et la liste ne signale rien : une coupure du bot ne doit pas
   * allumer toutes les paires en rouge.
   *
   * Un exchange absent du catalogue reçoit `[]`, pas `null` : la liste
   * `exchanges` servie par le bot est dérivée du même enregistrement, donc un
   * exchange qui n'y figure pas est un exchange pour lequel il ne propose
   * rien. C'est une réponse, pas une ignorance.
   */
  strategyStatus(exchangeKey: string, pair: TradingPair): PairStrategyStatus {
    const catalogue = this.botService.strategiesByExchange();
    return pairStrategyStatus(pair.strategy, catalogue ? (catalogue[exchangeKey] ?? []) : null);
  }

  /**
   * `true` quand ce build est certain que le bot laisse cette paire de côté,
   * **quelle qu'en soit la raison** — marché éteint ou stratégie inconnue.
   */
  notRunnable(exchangeKey: string, pair: TradingPair): boolean {
    return (
      isKnownUnexecutableMarket(this.marketStatus(pair)) ||
      isKnownUnexecutable(this.strategyStatus(exchangeKey, pair))
    );
  }

  // ------------------------------------------------------------------ //
  //  Market liveness
  // ------------------------------------------------------------------ //

  /**
   * Les dex à interroger pour juger les paires configurées, dédoublonnés.
   *
   * L'`equal` explicite n'est pas décoratif : `botEntries` se recalcule à
   * chaque basculement de toggle, et sans lui chaque clic relancerait le
   * chargement des univers — donc des requêtes vers Hyperliquid pour une
   * réponse identique.
   */
  private readonly requiredDexes = computed(
    () => dexesToLoad(this.botEntries().flatMap((entry) => entry.value.pairs.map((p) => p.name))),
    { equal: (a, b) => a.length === b.length && a.every((dex, i) => dex === b[i]) },
  );

  /**
   * ⚠️ Lecture seule, donc un `resource()` est le bon outil ici — l'interdit
   * de `docs/angular.md` ne vise que les **ordres**, qu'une annulation en vol
   * laisserait dans un état inconnu.
   *
   * Des `params` à `undefined` tant qu'aucune paire n'est configurée : sans
   * ça, un compte vide déclencherait quand même un appel `perpDexs`.
   */
  private readonly marketMeta = resource({
    params: computed(
      () => {
        const dexes = this.requiredDexes();
        return dexes.length ? { dexes } : undefined;
      },
      { equal: (a, b) => a?.dexes === b?.dexes },
    ),
    loader: async ({ params }) => {
      const dexes = await firstValueFrom(this.hlMarket.getPerpDexs());
      const universes = await Promise.all(
        params.dexes.map(
          async (dex) =>
            [dex, (await firstValueFrom(this.hlMarket.getPerpMeta(dex))).universe] as const,
        ),
      );

      return { dexes, universeByDex: new Map(universes) };
    },
  });

  /**
   * Le catalogue sous la forme qu'attend le domaine. Tant que la réponse n'est
   * pas là, `dexNames: null` fait rendre `unverified` et rien n'est signalé —
   * même règle que le statut de stratégie : une coupure réseau ne doit pas
   * allumer toutes les paires en rouge.
   */
  private readonly marketCatalogue = computed<PerpMarketCatalogue>(() => {
    const meta = this.marketMeta.value();

    return {
      dexNames: meta ? meta.dexes.flatMap((dex) => (dex ? [dex.name] : [])) : null,
      universeByDex: meta?.universeByDex ?? new Map(),
    };
  });

  /** Le marché de cette paire existe-t-il encore, et peut-on encore le savoir ? */
  marketStatus(pair: TradingPair): PairMarketStatus {
    return pairMarketStatus(pair.name, this.marketCatalogue());
  }

  /**
   * Le nom lisible du dex de cette paire (« Ventuals »), ou `null` quand on ne
   * l'a pas — le libellé reste alors générique au lieu d'inventer un nom.
   */
  marketDexLabel(pair: TradingPair): string | null {
    return dexLabel(hlPerpDexOf(pair.name) ?? '', this.marketMeta.value()?.dexes ?? null);
  }

  /**
   * Ouvre la paire fautive sur son formulaire, sans rien décider à sa place :
   * le sélecteur y est vide et l'enregistrement bloqué tant qu'aucune
   * stratégie n'est choisie. Désactiver la paire d'office serait à la fois
   * intrusif et inutile — une paire que le bot ignore ne fait déjà rien.
   */
  fixPair(exchangeKey: string, pair: TradingPair, event: Event): void {
    event.stopPropagation();
    void this.openEditModal(exchangeKey, pair);
  }

  // ------------------------------------------------------------------ //
  //  Modal helpers
  // ------------------------------------------------------------------ //

  async openAddModal(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: TradingPairModalComponent,
      componentProps: {
        exchanges: () => this.botEntries(),
      },
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<TradingPairModalResult>();
    if (role === 'confirm' && data) this.applyAdd(data);
  }

  async openEditModal(exchangeKey: string, pair: TradingPair): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: TradingPairModalComponent,
      componentProps: {
        exchanges: () => this.botEntries(),
        editPair: () => pair,
        editExchangeKey: () => exchangeKey,
      },
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<TradingPairModalResult>();
    if (role === 'confirm' && data) this.applyEdit(data, pair.name);
  }

  // ------------------------------------------------------------------ //
  //  CRUD operations
  // ------------------------------------------------------------------ //

  private applyAdd({ exchangeKey, pair }: TradingPairModalResult): void {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      const pairs = [...user.tradingSettings[exchangeKey].pairs, pair];
      return this.patchExchange(user, exchangeKey, { pairs });
    });
    this.triggerSave();
  }

  private applyEdit({ exchangeKey, pair }: TradingPairModalResult, nameRef: string): void {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      const pairs = user.tradingSettings[exchangeKey].pairs.map((p) =>
        p.name === nameRef ? pair : p,
      );
      return this.patchExchange(user, exchangeKey, { pairs });
    });
    this.triggerSave();
  }

  deletePair(exchangeKey: string, pairName: string): void {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      const pairs = user.tradingSettings[exchangeKey].pairs.filter((p) => p.name !== pairName);
      return this.patchExchange(user, exchangeKey, { pairs });
    });
    this.triggerSave();
  }

  onExchangeToggle(exchangeKey: string, enabled: boolean): void {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      return this.patchExchange(user, exchangeKey, { enabled });
    });
    this.triggerSave();
  }

  onPairToggle(exchangeKey: string, pairName: string, enabled: boolean): void {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      const pairs = user.tradingSettings[exchangeKey].pairs.map((p) =>
        p.name === pairName ? { ...p, enabled } : p,
      );
      return this.patchExchange(user, exchangeKey, { pairs });
    });
    this.triggerSave();
  }

  // ------------------------------------------------------------------ //
  //  Protective
  // ------------------------------------------------------------------ //

  async openProtectiveStrategyModal(exchangeKey: string, pair: TradingPair): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ProtectiveModalComponent,
      componentProps: {
        pair: () => pair,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'protective-modal',
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss<ProtectiveModalResult>();
    if (role === 'confirm' && data) {
      this.applyProtectiveStrategy(data.pair, exchangeKey, pair.name);
    }
  }

  private applyProtectiveStrategy(
    updatedPair: TradingPair,
    exchangeKey: string,
    originalName: string,
  ): void {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      const pairs = user.tradingSettings[exchangeKey].pairs.map((p) =>
        p.name === originalName ? updatedPair : p,
      );
      return this.patchExchange(user, exchangeKey, { pairs });
    });
    this.triggerSave();
  }

  protGroups(entries: ProtectiveOrderEntry[]) {
    const tp = entries.filter((e) => e.tpsl === 'tp');
    const sl = entries.filter((e) => e.tpsl === 'sl');
    const singleLine = tp.length === 1 && sl.length === 1;
    return singleLine ? [tp.concat(sl)] : [tp, sl].filter((g) => g.length);
  }

  protectiveEntries(pair: TradingPair): ProtectiveOrderEntry[] {
    return pair.strategy?.protective?.entries ?? [];
  }

  // ------------------------------------------------------------------ //
  //  Private helpers
  // ------------------------------------------------------------------ //

  private patchExchange(
    user: ExternalUser,
    exchangeKey: string,
    patch: Partial<IExchange>,
  ): ExternalUser {
    return {
      ...user,
      tradingSettings: {
        ...user.tradingSettings,
        [exchangeKey]: { ...user.tradingSettings![exchangeKey], ...patch },
      },
    };
  }

  /**
   * Ce qu'un enregistrement refusé laisse à l'écran, dit une fois.
   *
   * ⚠️ Le toast annonce l'échec ; il ne le répare pas. L'interrupteur continue
   * d'afficher ce que l'utilisateur a demandé, alors que le compte tient encore
   * l'état précédent — et plus rien ne le rappelle une fois les quatre secondes
   * passées. Remettre l'écran d'accord avec le compte demanderait de relire le
   * compte, ce que la page ne peut pas faire seule : `RefreshableLayoutComponent`
   * garde sa propre copie des données et n'expose aucun rechargement (le piège
   * déjà rencontré dans `strategies.page.spec.ts`). C'est une décision à part.
   *
   * ⚠️ Sa portée est plus étroite qu'il n'y paraît : un **401** ne l'atteint
   * pas, l'intercepteur déconnectant et redirigeant avant
   * (`auth.interceptor.ts`). Restent les `400`, les `5xx` et le réseau coupé.
   */
  private async announceSaveFailure(reason: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: `Not saved — ${reason} The account still holds the previous settings.`,
      color: 'danger',
      duration: 4000,
    });
    await toast.present();
  }

  private triggerSave(): void {
    const tradingSettings = this.user()?.tradingSettings;
    if (tradingSettings) this.save$.next(tradingSettings);
  }
}
