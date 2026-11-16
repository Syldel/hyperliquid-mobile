import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConfigService } from '@services/config.service';
import { withWalletToken } from '../interceptors/auth.interceptor';
import {
  CollateralBalanceResponse,
  HLCancelOrderResponse,
  HLOid,
  HLOrderDetails,
  HLOrderGrouping,
  HLOrderStatusResponse,
  HLPlaceOrderResponse,
  HLSuccessResponse,
} from '@syldel/hl-shared-types';
import { finalize, Observable } from 'rxjs';
import { AccountActivityService, AccountWrite } from './account-activity.service';

@Injectable({ providedIn: 'root' })
export class HyperliquidGatewayService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);
  private readonly activity = inject(AccountActivityService);

  private post<T>(path: string, body: object): Observable<T> {
    return this.http.post<T>(
      `${this.config.hyperliquidGatewayUrl}/${path}`,
      body,
      withWalletToken(),
    );
  }

  /**
   * Une écriture au compte, signalée **quelle qu'en soit l'issue** : `finalize` passe sur le succès, sur
   * l'erreur et sur l'abandon.
   *
   * Pas seulement sur le succès, parce qu'un échec ne garantit pas que rien n'a changé : une
   * modification refusée avec « Error placing new order during modify » a **annulé** l'ordre d'origine
   * (mesuré : `nest-trading-bot/docs/hyperliquid/live-check.md`), et une réponse perdue en route laisse
   * l'état inconnu. Relire coûte une lecture ; ne pas relire affiche un ordre qui n'existe plus.
   */
  private write<T>(kind: AccountWrite['kind'], path: string, body: object): Observable<T> {
    return this.post<T>(path, body).pipe(finalize(() => this.activity.record(kind)));
  }

  // ── Account info ───────────────────────────────────────────────────────────

  /**
   * Le collatéral dans lequel un marché se règle, et le solde du compte dans ce
   * collatéral.
   *
   * ⚠️ Cet appel vit **ici** et non dans `AvailableCapitalService` pour une
   * raison de contrat : seuls trois fichiers ont le droit de réclamer le jeton
   * du wallet (`wallet-token-callers.spec.ts`), et celui-ci en fait partie.
   *
   * Pourquoi demander plutôt que calculer : le mobile posait en dur « le compte
   * est TOUJOURS en mode Unified Account » et lisait donc les soldes **spot**
   * pour une paire perp. Mesuré le 2026-10-01 sur `0x7284…7083` :
   * `userAbstraction` rend `"default"`, l'état perp vaut `0.0` et le spot
   * `0.01079182` USDC — l'app affichait donc comme capital perp un argent qui
   * n'en est pas. Le mode se lit, il ne se suppose pas.
   */
  getCollateralBalance(asset: string): Observable<CollateralBalanceResponse> {
    return this.http.get<CollateralBalanceResponse>(
      `${this.config.hyperliquidGatewayUrl}/hyperliquid/info/collateral-balance`,
      { ...withWalletToken(), params: { asset } },
    );
  }

  // ── Orders info ────────────────────────────────────────────────────────────

  getOrderStatus(oid: number): Observable<HLOrderStatusResponse> {
    return this.http.get<HLOrderStatusResponse>(
      `${this.config.hyperliquidGatewayUrl}/hyperliquid/orders/open/${oid}`,
      withWalletToken(),
    );
  }

  // ── Trade actions ──────────────────────────────────────────────────────────

  cancelOrder(
    cancels: Array<{ asset: number; oid: HLOid }>,
    isTestnet = false,
  ): Observable<HLSuccessResponse<HLCancelOrderResponse>> {
    return this.write<HLSuccessResponse<HLCancelOrderResponse>>(
      'cancel',
      'hyperliquid/order/cancel',
      {
        cancels,
        isTestnet,
      },
    );
  }

  placeOrder(
    order: HLOrderDetails,
    grouping: HLOrderGrouping = 'na',
    isTestnet = false,
  ): Observable<HLSuccessResponse<HLPlaceOrderResponse>> {
    return this.write<HLSuccessResponse<HLPlaceOrderResponse>>('place', 'hyperliquid/order', {
      order,
      grouping,
      isTestnet,
    });
  }

  placeOrders(
    orders: HLOrderDetails[],
    grouping: HLOrderGrouping = 'na',
    isTestnet = false,
  ): Observable<HLSuccessResponse<HLPlaceOrderResponse>> {
    return this.write<HLSuccessResponse<HLPlaceOrderResponse>>('place', 'hyperliquid/orders', {
      orders,
      grouping,
      isTestnet,
    });
  }

  /**
   * Modifie un ordre — par un `batchModify` à **une** entrée, et non par `modify`.
   *
   * Une modification remplace l'ordre : l'ancien oid passe `canceled`, un nouveau naît. `modify` répond
   * `{"type":"default"}`, sans ce nouvel oid ; `batchModify` le rend dans `statuses[0].resting.oid`
   * (mesuré par cette route le 2026-11-09, `nest-trading-bot/docs/hyperliquid/live-check.md`, W4). Sans
   * lui, la page de détail relisait l'ancien oid et affichait « canceled » après un succès. Même
   * conversion d'ordre côté gateway (`mapOrderType`, `convertToApiOrder`), même coût : une action.
   * La réponse se lit avec `readModifyOutcome`.
   */
  modifyOrder(
    oid: HLOid,
    order: HLOrderDetails,
    isTestnet = false,
  ): Observable<HLSuccessResponse<HLPlaceOrderResponse>> {
    return this.write<HLSuccessResponse<HLPlaceOrderResponse>>(
      'modify',
      'hyperliquid/order/batch-modify',
      {
        modifies: [{ oid, order }],
        isTestnet,
      },
    );
  }

  // TODO
  // updateLeverage
  // POST 'hyperliquid/leverage'
  // UpdateLeverageParams
  // return HLSuccessResponse
}
