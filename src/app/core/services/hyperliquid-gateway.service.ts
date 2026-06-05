import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConfigService } from '@services/config.service';
import { HLCancelOrderResponse, HLOid, HLOrderStatusDetails } from '@syldel/hl-shared-types';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class HyperliquidGatewayService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);

  private post<T>(path: string, body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidGatewayUrl}/${path}`, body);
  }

  // ── Orders info ────────────────────────────────────────────────────────────

  getOrderStatus(oid: number): Observable<HLOrderStatusDetails> {
    return this.http.get<HLOrderStatusDetails>(
      `${this.config.hyperliquidGatewayUrl}/hyperliquid/orders/open/${oid}`,
    );
  }

  // ── Trade actions ──────────────────────────────────────────────────────────

  cancelOrder(
    cancels: Array<{ asset: number; oid: HLOid }>,
    isTestnet = false,
  ): Observable<HLCancelOrderResponse> {
    return this.post<HLCancelOrderResponse>('hyperliquid/order/cancel', { cancels, isTestnet });
  }

  // Phase 2
  // modifyOrder(oid: number, order: HLOrderDetails, isTestnet = false): Observable<unknown>
  // batchModifyOrders(modifies: ..., isTestnet = false): Observable<unknown>
}
