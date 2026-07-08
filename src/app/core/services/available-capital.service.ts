import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { HyperliquidInfoService } from './hyperliquid-info.service';

interface SpotBalance {
  coin: string;
  total: string;
  hold: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Hypothèse structurante de ce service : le compte est TOUJOURS en mode
 * Unified Account (cf. doc Hyperliquid, "Account abstraction modes").
 *
 * Conséquence directe (doc officielle) :
 * "For API users, unified account ... show all balances and holds in the
 *  spot clearinghouse state. Individual perp dex user states are not
 *  meaningful."
 *
 * => Il n'y a donc PAS de branchement "perp state par DEX" ici. Le solde
 *    spot (getTokenBalances) est l'unique source de collatéral, que la
 *    paire soit spot ou perp. Si un jour le mode Standard/Manual doit être
 *    supporté, il faudra réintroduire une branche équivalente à
 *    `getCachedPerpState` côté Nest, gardée derrière la détection du mode.
 */
@Injectable({ providedIn: 'root' })
export class AvailableCapitalService {
  private readonly hlInfo = inject(HyperliquidInfoService);

  private readonly BALANCE_TTL_MS = 10_000;

  // Un seul cache global pour TOUS les soldes spot : on ne les récupère
  // qu'une fois, puis on route vers le bon actif de collatéral en mémoire.
  // Ça évite l'ancien bug de clé de cache par paire/dex qui pouvait faire
  // collisionner deux quote assets différents (ex: XYZ/USDC et ABC/USDT).
  private spotBalancesCache: CacheEntry<SpotBalance[]> | null = null;

  /**
   * Capital disponible = total - hold (et non `hold` seul, qui représente
   * au contraire le montant bloqué par des ordres ouverts).
   */
  getAvailableCapital(dex: string, pairName: string): Observable<number> {
    const collateralAsset = this.resolveCollateralAsset(dex, pairName);

    return this.getCachedSpotBalances().pipe(
      map((balances) => {
        const entry = balances.find((b) => b.coin === collateralAsset);
        if (!entry) return 0;

        const total = parseFloat(entry.total);
        const hold = parseFloat(entry.hold);
        return Math.max(total - hold, 0);
      }),
    );
  }

  /**
   * Détermine l'actif de collatéral pertinent :
   * - Spot  : le quote asset réel de la paire (ex: "XYZ/USDT" -> USDT),
   *           jamais une liste de fallback statique.
   * - Perp  : dépend du DEX de rattachement, à défaut d'override explicite
   *           (mêmes règles que côté Nest : HYNA -> USDE, CASH -> USDT,
   *           sinon USDC, cf. doc "USDC balance is the single source for
   *           validator-operated perps... USDT balance is the single
   *           source for CASH perps").
   */
  private resolveCollateralAsset(dex: string, pairName: string): string {
    const isSpot = pairName.includes('/');

    if (isSpot) {
      const [, quote] = pairName.split('/');
      return (quote ?? 'USDC').toUpperCase();
    }

    const dexLower = (dex ?? '').toLowerCase();
    if (dexLower === 'hyna') return 'USDE';
    if (dexLower === 'cash') return 'USDT';
    return 'USDC';
  }

  private getCachedSpotBalances(): Observable<SpotBalance[]> {
    const now = Date.now();
    if (this.spotBalancesCache && this.spotBalancesCache.expiresAt > now) {
      return of(this.spotBalancesCache.value);
    }

    return this.hlInfo.getTokenBalances().pipe(
      tap((balances) => {
        this.spotBalancesCache = {
          value: balances,
          expiresAt: now + this.BALANCE_TTL_MS,
        };
      }),
    );
  }

  /**
   * Invalide le cache (ex: après un ordre exécuté, un dépôt/retrait...).
   * Les paramètres sont conservés pour compat avec les appels existants
   * mais n'ont plus d'effet : le cache est désormais global puisqu'il n'y
   * a plus qu'une seule source (spot balances) à invalider.
   */
  invalidate(_dex?: string, _pairName?: string): void {
    this.spotBalancesCache = null;
  }
}
