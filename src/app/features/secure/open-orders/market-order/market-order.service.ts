import { inject, Injectable, signal } from '@angular/core';
import { HyperliquidGatewayService } from '@services/hyperliquid-gateway.service';
import { HyperliquidInfoService } from '@services/hyperliquid-info.service';
import { StorageService } from '@storage/storage.service';
import { hlPerpDexOf, type HLOrderDetails } from '@syldel/hl-shared-types';
import { catchError, forkJoin, map, Observable, of, shareReplay, tap, throwError } from 'rxjs';
import { DEFAULT_MAX_SLIPPAGE_PCT, isValidMaxSlippage } from './market-execution.util';
import { readMarketHttpError, readMarketReply, type MarketFillOutcome } from './market-fill.util';
import { readMarketSnapshot, type SnapshotReading } from './market-snapshot.util';

/**
 * Le taux taker affiché à la confirmation. `account` : lu par `userFees`, net du palier de volume
 * et de la remise de staking. `fallback` : le palier 0 de la page des frais (0,045 % pour les
 * perps, `fees.md`), étiqueté comme tel — jamais présenté comme le taux du compte.
 */
export type TakerRate =
  | { status: 'account'; rate: number }
  | { status: 'fallback'; rate: number; reason: string };

export const TIER_ZERO_TAKER_RATE = 0.00045;

const SLIPPAGE_STORAGE_KEY = 'app_hl_market_max_slippage_pct';

/**
 * Ce qu'un ordre au marché lit et envoie. Aucune écriture ne passe par `resource()` (Angular y
 * annule les chargements en vol, et une écriture annulée est un ordre dont on ignore l'état) : un
 * envoi est un `Observable` souscrit une fois, par l'écran, au clic.
 */
@Injectable({ providedIn: 'root' })
export class MarketOrderService {
  private readonly info = inject(HyperliquidInfoService);
  private readonly gateway = inject(HyperliquidGatewayService);
  private readonly storage = inject(StorageService);

  private readonly _maxSlippagePct = signal(DEFAULT_MAX_SLIPPAGE_PCT);
  /** Le glissement maximal en %, partagé par le formulaire d'ordre et la fermeture. */
  readonly maxSlippagePct = this._maxSlippagePct.asReadonly();
  private slippageLoaded = false;

  private takerRate$: Observable<TakerRate> | null = null;

  /**
   * Lit le réglage mémorisé, une fois. Une valeur hors bornes (stockage d'une autre version, édition
   * à la main) n'est pas reprise : le défaut s'applique, et la console le dit.
   */
  async loadMaxSlippage(): Promise<void> {
    if (this.slippageLoaded) return;
    this.slippageLoaded = true;
    try {
      const stored = await this.storage.get<number>(SLIPPAGE_STORAGE_KEY);
      if (stored === null) return;
      if (typeof stored === 'number' && isValidMaxSlippage(stored)) {
        this._maxSlippagePct.set(stored);
      } else {
        console.warn(
          `[MarketOrder] Ignoring the stored max slippage ${JSON.stringify(stored)}: out of bounds. Using ${DEFAULT_MAX_SLIPPAGE_PCT} %.`,
        );
      }
    } catch (error) {
      console.error('[MarketOrder] Could not read the stored max slippage', error);
    }
  }

  /** Mémorise un glissement valide. Une valeur invalide est refusée par l'écran, pas ici. */
  setMaxSlippage(pct: number): void {
    if (!isValidMaxSlippage(pct)) return;
    this._maxSlippagePct.set(pct);
    this.storage.set(SLIPPAGE_STORAGE_KEY, pct).catch((error: unknown) => {
      console.error('[MarketOrder] Could not store the max slippage', error);
    });
  }

  /**
   * Le carnet et le contexte de l'actif, lus ensemble (poids 2 + 20). Perps seulement : un spot n'a
   * ni mark ni oracle, et l'ordre au marché ne s'y propose pas (décidé le 2026-11-12).
   */
  readSnapshot(coin: string): Observable<SnapshotReading> {
    const dex = hlPerpDexOf(coin);
    if (dex === null) {
      return throwError(() => new Error(`"${coin}" is not a perp market: no market order here.`));
    }
    return forkJoin([this.info.getL2Book(coin), this.info.getMetaAndAssetCtxs(dex)]).pipe(
      map(([book, metaAndCtx]) => readMarketSnapshot(coin, book, metaAndCtx, Date.now())),
    );
  }

  /**
   * Le taux taker du compte, lu une fois par session : il change au plus une fois par jour (palier
   * sur 14 jours). Un échec n'est pas mémorisé — la confirmation suivante relit — et rend le palier
   * 0 étiqueté, pour que les frais restent affichés.
   */
  takerRate(): Observable<TakerRate> {
    if (!this.takerRate$) {
      this.takerRate$ = this.info.getUserFees().pipe(
        map((fees): TakerRate => {
          const rate = Number(fees?.userCrossRate);
          if (!(rate >= 0) || !Number.isFinite(rate)) {
            throw new Error(`userCrossRate is not a rate: ${JSON.stringify(fees?.userCrossRate)}`);
          }
          return { status: 'account', rate };
        }),
        shareReplay(1),
      );
    }
    return this.takerRate$.pipe(
      catchError((error: unknown) => {
        this.takerRate$ = null;
        console.error('[MarketOrder] Could not read the account fees', error);
        return of<TakerRate>({
          status: 'fallback',
          rate: TIER_ZERO_TAKER_RATE,
          reason: 'account fees unreadable: tier 0 rate shown',
        });
      }),
    );
  }

  /**
   * Envoie l'ordre, UNE fois. Jamais relancé, quoi qu'il arrive : un échec réseau ou un 5xx est un
   * état inconnu (`unknown`), pas une invitation à renvoyer.
   */
  send(order: HLOrderDetails): Observable<MarketFillOutcome> {
    return this.gateway.placeOrder(order).pipe(
      map((reply) => readMarketReply(reply, order.sz)),
      catchError((error: unknown) => of(readMarketHttpError(error as Error))),
      tap((outcome) => {
        if (outcome.kind === 'unknown') {
          console.error(`[MarketOrder] ${order.assetName}: state unknown`, outcome.message);
        }
      }),
    );
  }

  /**
   * La position sur `coin` après un état inconnu : relue une fois (poids 2), jamais en boucle.
   * `null` : pas de position. Une erreur se propage — l'écran dit que la relecture a échoué.
   */
  readPositionSize(coin: string): Observable<number | null> {
    const dex = hlPerpDexOf(coin);
    if (dex === null) return throwError(() => new Error(`"${coin}" is not a perp market.`));
    return this.info.getClearinghouseState(dex).pipe(
      map((state) => {
        const position = state.assetPositions.find((ap) => ap.position?.coin === coin)?.position;
        const szi = Number(position?.szi);
        return position && Number.isFinite(szi) && szi !== 0 ? szi : null;
      }),
    );
  }
}
