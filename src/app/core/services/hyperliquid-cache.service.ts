import {
  computed,
  effect,
  inject,
  Injectable,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  HLFrontendOpenOrder,
  HLOrderStatusData,
  HLUserFill,
  HLUserFillsByTimeRequest,
} from '@syldel/hl-shared-types';
import { HyperliquidInfoService } from './hyperliquid-info.service';

// ─── Types publics ────────────────────────────────────────────────────────────

export interface HLCoinSnapshot {
  coin: string;
  openOrders: HLFrontendOpenOrder[];
  historicalOrders: HLOrderStatusData[];
  fills: HLUserFill[];
}

export interface HLCacheConfig {
  /** Nombre de jours d'historique fills. Défaut : 30. */
  fillsLookbackDays?: number;
  /** DEX optionnel pour getFrontendOpenOrders. */
  dex?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class HyperliquidCacheService {
  private readonly hlInfo = inject(HyperliquidInfoService);

  private readonly refreshTick = signal(0);
  private lastRefresh = 0;

  // ── Config réactive ───────────────────────────────────────────────────────
  /** Modifiable pour changer le lookback ou le dex à la volée. */
  readonly config = signal<Required<HLCacheConfig>>({
    fillsLookbackDays: 30,
    dex: '',
  });

  // ── Coin actif (watchlist detail) ─────────────────────────────────────────
  /**
   * linkedSignal : conserve le coin précédent si config change,
   * mais peut être réinitialisé proprement si besoin.
   */
  readonly selectedCoin = linkedSignal<Required<HLCacheConfig>, string | null>({
    source: this.config,
    computation: (_cfg, prev) => prev?.value ?? null,
  });

  constructor() {
    // Dès que le coin change, met à jour config.dex automatiquement
    effect(() => {
      const coin = this.selectedCoin();
      if (!coin) return;
      const { dex } = parseCoin(coin);
      // untracked pour ne pas créer de cycle config → selectedCoin → config
      untracked(() => {
        this.config.update((c) => ({ ...c, dex }));
      });
    });
  }

  // ── Resources (= fetches réactifs) ────────────────────────────────────────

  /**
   * Open orders — se re-fetche automatiquement si config.dex change.
   */
  readonly openOrdersResource = resource({
    params: computed(() => ({ dex: this.config().dex, _refresh: this.refreshTick() })),
    loader: ({ params }) => firstValueFrom(this.hlInfo.getFrontendOpenOrders(params.dex)),
  });

  /**
   * Historical orders — pas de param dynamique, chargé une fois.
   */
  readonly historicalOrdersResource = resource({
    params: computed(() => ({ _refresh: this.refreshTick() })),
    loader: () => firstValueFrom(this.hlInfo.getHistoricalOrders()),
  });

  /**
   * Fills — se re-fetche si le lookback change.
   */
  readonly fillsResource = resource({
    params: computed(() => ({
      lookback: this.config().fillsLookbackDays,
      _refresh: this.refreshTick(),
    })),
    loader: ({ params }): Promise<HLUserFill[]> => {
      const req: HLUserFillsByTimeRequest = {
        startTime: Date.now() - params.lookback * 24 * 60 * 60 * 1000,
      };
      return firstValueFrom(this.hlInfo.getUserFillsByTime(req));
    },
  });

  // ── Computed dérivés ──────────────────────────────────────────────────────

  readonly openOrders = computed(() => this.openOrdersResource.value() ?? []);
  readonly historicalOrders = computed(() => this.historicalOrdersResource.value() ?? []);
  readonly fills = computed(() => this.fillsResource.value() ?? []);

  /** True si au moins une resource est en cours de fetch. */
  readonly loading = computed(
    () =>
      this.openOrdersResource.isLoading() ||
      this.historicalOrdersResource.isLoading() ||
      this.fillsResource.isLoading(),
  );

  /** Erreurs agrégées. */
  readonly errors = computed(() => ({
    openOrders: this.openOrdersResource.error() ?? null,
    historicalOrders: this.historicalOrdersResource.error() ?? null,
    fills: this.fillsResource.error() ?? null,
  }));

  /**
   * Snapshot complet filtré sur le coin sélectionné.
   * Recalculé automatiquement dès que openOrders / fills / selectedCoin changent.
   */
  readonly coinSnapshot = computed<HLCoinSnapshot | null>(() => {
    const coin = this.selectedCoin();
    if (!coin) return null;
    return this.buildSnapshot(coin);
  });

  // ── API publique ──────────────────────────────────────────────────────────

  selectCoin(coin: string): void {
    this.selectedCoin.set(coin);
  }

  updateConfig(partial: Partial<HLCacheConfig>): void {
    this.config.update((c) => ({ ...c, ...partial }));
  }

  reloadAll(force = false): void {
    const now = Date.now();

    if (!force && now - this.lastRefresh < 60 * 1000) {
      return;
    }

    this.lastRefresh = now;
    this.refreshTick.update((v) => v + 1);
  }

  /** Computed filtré pour un coin arbitraire (pre-render, prefetch…). */
  snapshotFor(coin: string) {
    return computed(() => this.buildSnapshot(coin));
  }

  openOrdersFor(coin: string) {
    return computed(() =>
      this.openOrders().filter((o) => normalizeCoin(o.coin) === normalizeCoin(coin)),
    );
  }

  historicalOrdersFor(coin: string) {
    return computed(() =>
      this.historicalOrders().filter((o) => normalizeCoin(o.order.coin) === normalizeCoin(coin)),
    );
  }

  fillsFor(coin: string) {
    return computed(() =>
      this.fills().filter((f) => normalizeCoin(f.coin) === normalizeCoin(coin)),
    );
  }

  // ── Privé ─────────────────────────────────────────────────────────────────

  private buildSnapshot(coin: string): HLCoinSnapshot {
    const nc = normalizeCoin(coin);
    return {
      coin,
      openOrders: this.openOrders().filter((o) => normalizeCoin(o.coin) === nc),
      historicalOrders: this.historicalOrders().filter((o) => normalizeCoin(o.order.coin) === nc),
      fills: this.fills().filter((f) => normalizeCoin(f.coin) === nc),
    };
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function normalizeCoin(coin: string): string {
  return coin.toUpperCase().split('-')[0];
}

/** Extrait le dex et le coin name depuis une string "dex:COIN" ou "COIN". */
function parseCoin(coin: string): { dex: string; coinName: string } {
  const idx = coin.indexOf(':');
  if (idx === -1) return { dex: '', coinName: coin };
  return {
    dex: coin.slice(0, idx),
    coinName: coin,
  };
}
