import {
  computed,
  effect,
  inject,
  Injectable,
  linkedSignal,
  resource,
  ResourceRef,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '@auth/auth.service';
import {
  HLFrontendOpenOrder,
  HLOrderStatusData,
  HLUserFill,
  HLUserFillsByTimeRequest,
} from '@syldel/hl-shared-types';
import { marketKindLabel, openOrdersDexOf } from '@utils/market-kind.util';
import { AccountActivityService } from './account-activity.service';
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

/** Ce qu'une lecture du compte nourrit à l'écran — pour dire lequel manque, pas seulement qu'il manque. */
export type HLCacheSource = 'openOrders' | 'historicalOrders' | 'fills';

/**
 * Délai minimal entre deux relectures **non forcées** — un retour au premier plan, une page qui
 * réapparaît. Une relecture coûte 60 de poids au moins, jusqu'à ~260 si l'historique et les fills
 * rendent 2000 lignes chacun (`nest-hyperliquid-gateway/docs/rate-limits.md`), sur l'IP du téléphone.
 */
export const ACCOUNT_RELOAD_THROTTLE_MS = 60_000;

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Les ordres et les fills du compte, tels que le chart de watchlist-detail les dessine.
 *
 * Trois règles, chacune tirée d'un défaut constaté le 2026-11-15 :
 *
 * - **le compte fait partie de la clé.** Les lectures prennent l'adresse au moment de l'appel, mais rien
 *   ne les relançait quand elle changeait : en changeant de compte puis en rouvrant un chart dans la
 *   minute, le chart du compte B portait les ordres et les fills du compte A ;
 * - **une écriture au compte relit, sans délai** (`AccountActivityService`, nourri par le gateway). Avant,
 *   seul le `ngOnInit` de la page relisait, au plus une fois par minute — et la page reste vivante dans la
 *   pile Ionic pendant qu'on modifie un ordre ailleurs ;
 * - **une lecture en échec se dit** (`failures`). `resource.value()` **lève** sur une erreur : le
 *   `computed` qui le lisait levait à son tour dans le gabarit, et le chart restait sans lignes — ce qui se
 *   lit « aucun ordre ».
 */
@Injectable({ providedIn: 'root' })
export class HyperliquidCacheService {
  private readonly hlInfo = inject(HyperliquidInfoService);
  private readonly auth = inject(AuthService);
  private readonly activity = inject(AccountActivityService);

  /**
   * Initialisé à la construction, et non à 0 : les ressources lisent dès leur création. À 0, le
   * `reloadAll()` que la page appelle juste après passait le délai, et **chaque première visite lisait
   * deux fois** — relevé par la spec le 2026-11-15.
   */
  private lastRefresh = Date.now();

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

  // ── Resources (= fetches réactifs) ────────────────────────────────────────
  //
  // Les paramètres ne portent que ce qui **change la réponse** : le compte, le dex, le lookback. Un
  // rechargement passe par `reload()`, jamais par un compteur glissé dans les paramètres — un paramètre
  // qui change remet la valeur à vide pendant le chargement (source d'Angular 21, `_resource-chunk.mjs`),
  // et les lignes d'ordres clignotaient à chaque relecture. `reload()` garde l'ancienne valeur
  // jusqu'à la nouvelle.
  //
  // Sans compte, les paramètres valent `undefined` : la ressource reste au repos, rien n'est demandé.

  /** Open orders — relus si le compte ou le dex change. */
  readonly openOrdersResource = resource({
    params: computed(
      () => {
        const address = this.auth.currentAddress();
        return address ? { address, dex: this.config().dex } : undefined;
      },
      { equal: (a, b) => a?.address === b?.address && a?.dex === b?.dex },
    ),
    loader: ({ params }) => firstValueFrom(this.hlInfo.getFrontendOpenOrders(params.dex)),
  });

  /** Historical orders — relus si le compte change. */
  readonly historicalOrdersResource = resource({
    params: computed(() => {
      const address = this.auth.currentAddress();
      return address ? { address } : undefined;
    }),
    loader: () => firstValueFrom(this.hlInfo.getHistoricalOrders()),
  });

  /** Fills — relus si le compte ou le lookback change. */
  readonly fillsResource = resource({
    params: computed(
      () => {
        const address = this.auth.currentAddress();
        return address ? { address, lookback: this.config().fillsLookbackDays } : undefined;
      },
      { equal: (a, b) => a?.address === b?.address && a?.lookback === b?.lookback },
    ),
    loader: ({ params }): Promise<HLUserFill[]> => {
      const req: HLUserFillsByTimeRequest = {
        startTime: Date.now() - params.lookback * 24 * 60 * 60 * 1000,
      };
      return firstValueFrom(this.hlInfo.getUserFillsByTime(req));
    },
  });

  private readonly resources: Record<HLCacheSource, ResourceRef<unknown>> = {
    openOrders: this.openOrdersResource,
    historicalOrders: this.historicalOrdersResource,
    fills: this.fillsResource,
  };

  // ── Computed dérivés ──────────────────────────────────────────────────────
  //
  // `hasValue()` avant `value()` : sur une ressource en erreur, `value()` lève. Une source en échec rend
  // donc une liste vide ICI, et `failures` dit pourquoi elle est vide — jamais l'un sans l'autre.

  readonly openOrders = computed(() =>
    this.openOrdersResource.hasValue() ? (this.openOrdersResource.value() ?? []) : [],
  );
  readonly historicalOrders = computed(() =>
    this.historicalOrdersResource.hasValue() ? (this.historicalOrdersResource.value() ?? []) : [],
  );
  readonly fills = computed(() =>
    this.fillsResource.hasValue() ? (this.fillsResource.value() ?? []) : [],
  );

  /**
   * Les lectures dont la dernière tentative a échoué. Une liste vide n'y figure pas : « aucun ordre » est
   * une réponse, « ordres illisibles » n'en est pas une.
   */
  readonly failures = computed<HLCacheSource[]>(() =>
    (Object.keys(this.resources) as HLCacheSource[]).filter(
      (source) => this.resources[source].status() === 'error',
    ),
  );

  /**
   * Snapshot complet filtré sur le coin sélectionné.
   * Recalculé automatiquement dès que openOrders / fills / selectedCoin changent.
   */
  readonly coinSnapshot = computed<HLCoinSnapshot | null>(() => {
    const coin = this.selectedCoin();
    if (!coin) return null;
    return this.buildSnapshot(coin);
  });

  constructor() {
    // Une écriture au compte relit tout, tout de suite, sans le délai d'une minute : c'est précisément
    // le moment où l'écran a le plus de chances d'être faux. Le premier passage (valeur déjà présente
    // à la construction) ne relit rien — les ressources viennent de partir.
    //
    // On craignait qu'`historicalOrders` serve encore l'état d'avant à cet instant : éprouvé en réel
    // le 2026-11-15 (place, modify, cancel), la ligne suit à chaque fois. Un constat à l'écran, sans
    // délai mesuré (docs/roadmap.md, point 16) : si une ligne reste un jour à l'ancien prix, c'est ici
    // qu'il faudrait une seconde relecture après un court délai.
    let seen = untracked(this.activity.lastWrite);
    effect(() => {
      const write = this.activity.lastWrite();
      if (write === seen) return;
      seen = write;
      untracked(() => this.reloadAll(true));
    });
  }

  // ── API publique ──────────────────────────────────────────────────────────

  selectCoin(coin: string): void {
    const dex = dexToSelect(coin);
    if (dex === null) return;
    this.selectedCoin.set(coin);
    this.config.update((c) => (c.dex === dex ? c : { ...c, dex }));
  }

  updateConfig(partial: Partial<HLCacheConfig>): void {
    this.config.update((c) => ({ ...c, ...partial }));
  }

  selectCoinWithConfig(coin: string, partial: Partial<HLCacheConfig>): void {
    const dex = dexToSelect(coin);
    if (dex === null) return;
    this.selectedCoin.set(coin);
    this.config.update((c) => ({ ...c, ...partial, dex })); // écriture unique, dex + lookback ensemble
  }

  /**
   * Relit les trois sources. Sans `force`, pas plus d'une fois par `ACCOUNT_RELOAD_THROTTLE_MS` : c'est
   * le chemin des retours sur la page ou au premier plan, qui peuvent s'enchaîner.
   *
   * `force` est réservé à ce qui sait que l'état a changé ou que l'utilisateur le demande : une écriture
   * au compte, le bouton de rafraîchissement.
   */
  reloadAll(force = false): void {
    const now = Date.now();

    if (!force && now - this.lastRefresh < ACCOUNT_RELOAD_THROTTLE_MS) {
      return;
    }

    this.lastRefresh = now;
    for (const resource of Object.values(this.resources)) resource.reload();
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

/**
 * Le dex où lire les ordres du coin sélectionné (`openOrdersDexOf` : le sien pour un perp, le dex principal
 * pour un spot), ou `null` pour un nom que la règle ne sait pas classer ou dont le dex n'est pas connu (outcome).
 *
 * Dans ce cas la sélection est **refusée**, bruyamment : le dex principal n'est pas un repli. La découpe sur
 * `:` qui était là rendait `''` pour tout ce qui n'avait pas de préfixe, un nom douteux compris.
 */
function dexToSelect(coin: string): string | null {
  const dex = openOrdersDexOf(coin);
  if (dex === null) {
    console.error(
      `[HyperliquidCacheService] "${coin}" is ${marketKindLabel(coin)}: it has no dex to read the open orders of, so it is not selected.`,
    );
  }
  return dex;
}
