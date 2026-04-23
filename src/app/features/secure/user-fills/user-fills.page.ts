import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonBadge,
  IonButton,
  IonDatetime,
  IonDatetimeButton,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { HLUserFill } from '@syldel/hl-shared-types';
import { interval, Observable } from 'rxjs';

@Component({
  selector: 'app-user-fills',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    RefreshableLayoutComponent,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonDatetime,
    IonDatetimeButton,
    IonModal,
    IonSelect,
    IonSelectOption,
    IonButton,
  ],
  templateUrl: './user-fills.page.html',
  styleUrls: ['./user-fills.page.scss'],
})
export class UserFillsPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly lifecycle = inject(AppLifecycleService);

  fills = signal<HLUserFill[]>([]);
  coinFilter = signal<string>('');

  filteredFills = computed(() => {
    const coin = this.coinFilter().trim().toUpperCase();
    const fills = coin
      ? this.fills().filter((f) => f.coin.toUpperCase().includes(coin))
      : this.fills();
    return fills.slice().sort((a, b) => b.time - a.time);
  });

  availableCoins = computed(() => [...new Set(this.fills().map((f) => f.coin))].sort());

  coinCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const fill of this.fills()) {
      counts.set(fill.coin, (counts.get(fill.coin) ?? 0) + 1);
    }
    return counts;
  });

  readonly maxDate = signal(this.getCurrentMaxDate());
  readonly startDateStr = signal(this.toLocalISO(this.daysAgo(7)));
  readonly endDateStr = signal(this.toLocalISO(new Date()));
  readonly activeShortcut = signal<'24h' | '7d' | null>('7d');

  fetchFn = signal(this.buildFetchFn());

  constructor() {
    super();
    // Met à jour maxDate chaque minute
    interval(60_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.maxDate.set(this.getCurrentMaxDate()));

    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => {
        if (this.activeShortcut() === '24h') {
          this.startDateStr.set(this.toLocalISO(this.daysAgo(1)));
        } else if (this.activeShortcut() === '7d') {
          this.startDateStr.set(this.toLocalISO(this.daysAgo(7)));
        }
        this.endDateStr.set(this.toLocalISO(new Date()));
        this.fetchFn.set(this.buildFetchFn());
      });
    });
  }

  private getCurrentMaxDate(): string {
    const d = new Date();
    d.setSeconds(0, 0);
    return this.toLocalISO(d);
  }

  private buildFetchFn() {
    const startTime = new Date(this.startDateStr()).getTime();
    const endTime = new Date(this.endDateStr()).getTime();
    return () => this.hlInfo.getUserFillsByTime({ startTime, endTime }) as Observable<HLUserFill[]>;
  }

  private toLocalISO(date: Date): string {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  }

  private daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  isOpen(fill: HLUserFill): boolean {
    return fill.dir.toLowerCase().includes('open');
  }

  onStartChange(event: CustomEvent): void {
    this.activeShortcut.set(null);
    this.startDateStr.set(event.detail.value);
    this.fetchFn.set(this.buildFetchFn());
  }

  onEndChange(event: CustomEvent): void {
    this.activeShortcut.set(null);
    this.endDateStr.set(event.detail.value);
    this.fetchFn.set(this.buildFetchFn());
  }

  setLast24h(): void {
    this.activeShortcut.set('24h');
    this.startDateStr.set(this.toLocalISO(this.daysAgo(1)));
    this.endDateStr.set(this.toLocalISO(new Date()));
    this.fetchFn.set(this.buildFetchFn());
  }

  setLastWeek(): void {
    this.activeShortcut.set('7d');
    this.startDateStr.set(this.toLocalISO(this.daysAgo(7)));
    this.endDateStr.set(this.toLocalISO(new Date()));
    this.fetchFn.set(this.buildFetchFn());
  }
}
