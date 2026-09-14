import { TitleCasePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
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
} from '@ionic/angular/standalone';
import { TradingPair } from '@models/user.interface';
import { BotService } from '@services/bot.service';
import { UserService } from '@services/user.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
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
import { debounceTime, Subject, switchMap } from 'rxjs';
import {
  ProtectiveModalComponent,
  ProtectiveModalResult,
} from './components/protective-modal/protective-modal.component';
import {
  TradingPairModalComponent,
  TradingPairModalResult,
} from './components/trading-pair-modal/trading-pair-modal.component';
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

  user = signal<ExternalUser | null>(null);
  fetchFn = () => this.userService.getMe();

  botEntries = computed(() =>
    Object.entries(this.user()?.tradingSettings ?? {}).map(([key, value]) => ({ key, value })),
  );

  private readonly save$ = new Subject<Record<string, IExchange>>();

  readonly exitBehaviorLabels = this.botService.exitBehaviorLabels;

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

    this.save$
      .pipe(
        debounceTime(1000),
        switchMap((data) => this.userService.updateStrategy(data)),
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

  /** `true` quand ce build est certain que le bot laisse cette paire de côté. */
  notRunnable(exchangeKey: string, pair: TradingPair): boolean {
    return isKnownUnexecutable(this.strategyStatus(exchangeKey, pair));
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

  private triggerSave(): void {
    const tradingSettings = this.user()?.tradingSettings;
    if (tradingSettings) this.save$.next(tradingSettings);
  }
}
