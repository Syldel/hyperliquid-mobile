import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  IonItem,
  IonLabel,
  IonList,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { UserService } from '@services/user.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { DexSelectorComponent } from '@shared/components/dex-selector/dex-selector.component';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import {
  HLClearinghouseState,
  HLFrontendOpenOrder,
  HLPerpMarginSummary,
  HLPerpPositionDetail,
} from '@syldel/hl-shared-types';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { MarginSummaryComponent } from './components/margin-summary/margin-summary.component';
import { PositionItemComponent } from './components/position-item/position-item.component';
import {
  botManagedPairs,
  positionProtection,
  type PositionProtection,
} from './position-protection.util';

/**
 * Un dex lu : son état de compte, et ses ordres ouverts — `null` si leur lecture a échoué. Les ordres
 * servent au verdict de protection de chaque position (`position-protection.util.ts`) ; un échec de
 * cette seule lecture ne doit pas vider la page des positions, mais il ne doit pas non plus se lire
 * « aucun stop » : la carte dit alors « protection unknown ».
 */
interface DexReading {
  state: HLClearinghouseState;
  orders: HLFrontendOpenOrder[] | null;
}

/**
 * Ce que la page lit à chaque chargement. `botPairs` : les paires que le bot gère, lues dans le profil
 * (`botManagedPairs`), ou `null` si le profil n'a pas pu être lu — la carte le dit alors, plutôt que
 * de montrer chaque paire comme manuelle.
 */
interface PerpSummaryData {
  dexes: DexReading[];
  botPairs: Set<string> | null;
}

export interface PositionRow {
  position: HLPerpPositionDetail;
  protection: PositionProtection;
  /** `null` : on ne sait pas, le profil n'a pas pu être lu. */
  botManaged: boolean | null;
}

@Component({
  selector: 'app-perp-summary',
  standalone: true,
  imports: [
    RefreshableLayoutComponent,
    MarginSummaryComponent,
    PositionItemComponent,
    IonList,
    IonItem,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    SmartDecimalPipe,
    DexSelectorComponent,
  ],
  templateUrl: './perp-summary.page.html',
  styleUrls: ['./perp-summary.page.scss'],
})
export class PerpSummaryPage extends MenuBasePage {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly lifecycle = inject(AppLifecycleService);
  private readonly userService = inject(UserService);

  selectedDexNames = signal<string[] | null>(null);
  data = signal<PerpSummaryData>({ dexes: [], botPairs: null });
  clearinghouseStates = computed(() => this.data().dexes.map((r) => r.state));
  activeSegment = signal<'positions' | 'account'>('positions');

  fetchFn = signal(this.buildFetchFn());

  constructor() {
    super();
    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => {
        this.fetchFn.set(this.buildFetchFn());
      });
    });
  }

  /**
   * `null` tant que la sélection des dex n'est pas connue : le layout attend, indicateur affiché, au lieu
   * d'afficher une liste vide — voir `RefreshableLayoutComponent.fetchFn`.
   */
  private buildFetchFn(): (() => Observable<PerpSummaryData>) | null {
    const dexs = this.selectedDexNames();
    if (dexs === null) return null;

    // Poids par dex : `clearinghouseState` 2, `frontendOpenOrders` 20 — la lecture que fait déjà
    // Open Orders à chaque ouverture. Le profil vient du service utilisateur, pas d'Hyperliquid.
    return (): Observable<PerpSummaryData> =>
      forkJoin({
        dexes: forkJoin((dexs.length > 0 ? dexs : [undefined]).map((dex) => this.readDex(dex))),
        botPairs: this.userService.getMe().pipe(
          map((user) => botManagedPairs(user.tradingSettings)),
          catchError((error: unknown) => {
            console.error('[PerpSummary] user profile unreadable: bot pairs unknown', error);
            return of(null);
          }),
        ),
      });
  }

  private readDex(dex: string | undefined): Observable<DexReading> {
    const orders = this.hlInfo.getFrontendOpenOrders(dex).pipe(
      catchError((error: unknown) => {
        console.error(`[PerpSummary] open orders of dex "${dex ?? ''}" unreadable`, error);
        return of(null);
      }),
    );
    return forkJoin({ state: this.hlInfo.getClearinghouseState(dex), orders });
  }

  clearinghouseState = computed((): HLClearinghouseState | undefined => {
    const states = this.clearinghouseStates();
    if (states.length === 0) return undefined;
    if (states.length === 1) return states[0];

    // Cumul des valeurs numériques à travers les dexs
    const sumMargin = (key: keyof HLPerpMarginSummary) =>
      states
        .map((s) => parseFloat(s.marginSummary[key] as string))
        .reduce((a, b) => a + b, 0)
        .toString();

    const sumCrossMargin = (key: keyof HLPerpMarginSummary) =>
      states
        .map((s) => parseFloat(s.crossMarginSummary[key] as string))
        .reduce((a, b) => a + b, 0)
        .toString();

    return {
      ...states[0], // assetPositions, time, etc. déjà gérés ailleurs
      withdrawable: states
        .map((s) => parseFloat(s.withdrawable))
        .reduce((a, b) => a + b, 0)
        .toString(),
      crossMaintenanceMarginUsed: states
        .map((s) => parseFloat(s.crossMaintenanceMarginUsed))
        .reduce((a, b) => a + b, 0)
        .toString(),
      marginSummary: {
        accountValue: sumMargin('accountValue'),
        totalMarginUsed: sumMargin('totalMarginUsed'),
        totalNtlPos: sumMargin('totalNtlPos'),
        totalRawUsd: sumMargin('totalRawUsd'),
      },
      crossMarginSummary: {
        accountValue: sumCrossMargin('accountValue'),
        totalMarginUsed: sumCrossMargin('totalMarginUsed'),
        totalNtlPos: sumCrossMargin('totalNtlPos'),
        totalRawUsd: sumCrossMargin('totalRawUsd'),
      },
    };
  });

  /** Chaque position, avec le verdict lu dans les ordres de **son** dex : un dex ne voit pas ceux d'un autre. */
  positions = computed((): PositionRow[] => {
    const { dexes, botPairs } = this.data();
    return dexes.flatMap(({ state, orders }) =>
      state.assetPositions
        .filter((ap) => ap.position !== null)
        .map((ap) => ({
          position: ap.position!,
          protection: positionProtection(ap.position!, orders),
          botManaged: botPairs === null ? null : botPairs.has(ap.position!.coin),
        })),
    );
  });

  onSelectionChanged(dexNames: string[]) {
    this.selectedDexNames.set(dexNames);
    this.fetchFn.set(this.buildFetchFn());
  }

  /** Après une fermeture : relit les positions. */
  reload(): void {
    this.fetchFn.set(this.buildFetchFn());
  }

  openWatchlist(coin: string): void {
    this.router.navigate(['/secure/watchlist/detail', coin], {
      state: { backHref: '/secure/perp-summary' },
    });
  }
}
