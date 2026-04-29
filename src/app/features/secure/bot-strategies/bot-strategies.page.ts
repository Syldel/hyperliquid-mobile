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
import { BotSettings, ProtectiveOrderEntry, TradingPair, User } from '@models/user.interface';
import { UserService } from '@services/user.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { addIcons } from 'ionicons';
import {
  addOutline,
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

  user = signal<User | null>(null);
  fetchFn = () => this.userService.getMe();

  botEntries = computed(() =>
    Object.entries(this.user()?.tradingSettings ?? {}).map(([key, value]) => ({ key, value })),
  );

  private readonly save$ = new Subject<Record<string, BotSettings>>();

  constructor() {
    super();
    addIcons({
      addOutline,
      pencilOutline,
      trashOutline,
      shieldCheckmarkOutline,
      trendingUpOutline,
      trendingDownOutline,
    });

    this.save$
      .pipe(
        debounceTime(1000),
        switchMap((data) => this.userService.updateStrategy(data)),
      )
      .subscribe();
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

  sortedEntries(entries: ProtectiveOrderEntry[]): ProtectiveOrderEntry[] {
    return [...entries].sort((a, b) => (a.tpsl === b.tpsl ? 0 : a.tpsl === 'tp' ? -1 : 1));
  }

  // ------------------------------------------------------------------ //
  //  Private helpers
  // ------------------------------------------------------------------ //

  private patchExchange(user: User, exchangeKey: string, patch: Partial<BotSettings>): User {
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
