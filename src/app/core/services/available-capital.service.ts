import { inject, Injectable } from '@angular/core';
import { readAvailableCapital, type AvailableCapital } from '@utils/available-capital.utils';
import { catchError, map, Observable, of, shareReplay, tap } from 'rxjs';
import { HyperliquidGatewayService } from './hyperliquid-gateway.service';

/**
 * Le capital disponible pour une paire, **demandé** au gateway.
 *
 * Ce service calculait auparavant le collatéral lui-même, à partir d'une table
 * écrite en dur et de l'hypothèse « le compte est TOUJOURS en mode Unified
 * Account ». Les deux étaient fausses : la table désignait deux dex éteints en
 * 2026, et `userAbstraction` rend `"default"` sur le compte de développement —
 * l'app lisait donc les soldes **spot** pour une paire **perp**, c'est-à-dire
 * un argent qui n'est pas du collatéral perp dans ce mode.
 *
 * Le gateway lit le mode, route vers la bonne source et dérive le collatéral du
 * catalogue. Trois dépôts partagent désormais la même réponse, ce qui était
 * tout l'objet de ce chantier : le mobile, le bot et le gateway ne peuvent plus
 * afficher et exécuter deux chiffres différents.
 *
 * ⚠️ Conséquence assumée : l'affichage du capital dépend désormais du gateway
 * et d'un jeton valide. Dans le formulaire d'ordre ça ne change rien — poser un
 * ordre les exigeait déjà. Dans la configuration d'une paire du bot, c'est une
 * dépendance nouvelle : gateway éteint, la ligne dit « indisponible » au lieu
 * d'afficher un nombre. Un nombre faux valait moins que l'aveu.
 */
@Injectable({ providedIn: 'root' })
export class AvailableCapitalService {
  private readonly gateway = inject(HyperliquidGatewayService);

  private readonly TTL_MS = 10_000;

  private readonly cache = new Map<string, { value: AvailableCapital; expiresAt: number }>();

  /**
   * Les requêtes en vol, par marché.
   *
   * Sans elles, deux appels émis avant la première réponse partaient tous les
   * deux — mesuré le 2026-09-30 : deux appels simultanés, deux requêtes. Aucun
   * chemin de l'interface ne le déclenche aujourd'hui, mais la règle « ne
   * jamais bombarder » ne se vérifie pas au cas par cas.
   */
  private readonly inFlight = new Map<string, Observable<AvailableCapital>>();

  getAvailableCapital(pairName: string): Observable<AvailableCapital> {
    const cached = this.cache.get(pairName);
    if (cached && cached.expiresAt > Date.now()) return of(cached.value);

    const pending = this.inFlight.get(pairName);
    if (pending) return pending;

    const request = this.gateway.getCollateralBalance(pairName).pipe(
      map(readAvailableCapital),
      // Gateway éteint, jeton refusé, réseau coupé : l'app n'a pas pu demander.
      // Distinct d'une réponse du gateway, et surtout distinct de zéro.
      catchError(() => of<AvailableCapital>({ status: 'unavailable' })),
      tap((value) => {
        this.inFlight.delete(pairName);

        // Le TTL part de la **réponse**, pas de l'émission : une réponse lente
        // naissait déjà vieille. Et un échec de transport ne se met pas en
        // cache — il serait figé dix secondes après être redevenu possible.
        if (value.status !== 'unavailable') {
          this.cache.set(pairName, { value, expiresAt: Date.now() + this.TTL_MS });
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.inFlight.set(pairName, request);
    return request;
  }

  /** Après un ordre exécuté, un dépôt, un retrait — tout ce qui bouge un solde. */
  invalidate(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}
