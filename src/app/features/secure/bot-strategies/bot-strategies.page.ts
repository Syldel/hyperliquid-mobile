import { TitleCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  IonBadge,
  IonItem,
  IonItemDivider,
  IonItemGroup,
  IonLabel,
  IonList,
  IonToggle,
} from '@ionic/angular/standalone';
import { BotSettings, User } from '@models/user.interface';
import { UserService } from '@services/user.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { debounceTime, Subject, switchMap } from 'rxjs';

@Component({
  selector: 'app-bot-strategies',
  standalone: true,
  imports: [
    RefreshableLayoutComponent,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonItemGroup,
    IonItemDivider,
    IonToggle,
    TitleCasePipe,
  ],
  templateUrl: './bot-strategies.page.html',
  styleUrls: ['./bot-strategies.page.scss'],
})
export class BotStrategiesPage extends MenuBasePage {
  private readonly userService = inject(UserService);

  user = signal<User | null>(null);
  fetchFn = () => this.userService.getMe();

  botEntries = computed(() =>
    Object.entries(this.user()?.tradingSettings ?? {}).map(([key, value]) => ({ key, value })),
  );

  private readonly save$ = new Subject<Record<string, BotSettings>>();

  constructor() {
    super();
    this.save$
      .pipe(
        debounceTime(1000),
        switchMap((data) => this.userService.updateStrategy(data)),
      )
      .subscribe();
  }

  private triggerSave() {
    const tradingSettings = this.user()?.tradingSettings;
    if (tradingSettings) this.save$.next(tradingSettings);
  }

  onExchangeToggle(exchangeKey: string, enabled: boolean) {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      return {
        ...user,
        tradingSettings: {
          ...user.tradingSettings,
          [exchangeKey]: { ...user.tradingSettings[exchangeKey], enabled },
        },
      };
    });
    this.triggerSave();
  }

  onPairToggle(exchangeKey: string, pairName: string, enabled: boolean) {
    this.user.update((user) => {
      if (!user?.tradingSettings?.[exchangeKey]) return user;
      const pairs = user.tradingSettings[exchangeKey].pairs.map((p) =>
        p.name === pairName ? { ...p, enabled } : p,
      );
      return {
        ...user,
        tradingSettings: {
          ...user.tradingSettings,
          [exchangeKey]: { ...user.tradingSettings[exchangeKey], pairs },
        },
      };
    });
    this.triggerSave();
  }
}
