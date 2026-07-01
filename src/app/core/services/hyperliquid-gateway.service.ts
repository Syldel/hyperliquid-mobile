import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConfigService } from '@services/config.service';
import {
  HLCancelOrderResponse,
  HLOid,
  HLOrderDetails,
  HLOrderGrouping,
  HLOrderStatusResponse,
  HLPlaceOrderResponse,
  HLSuccessResponse,
} from '@syldel/hl-shared-types';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class HyperliquidGatewayService {
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);

  private post<T>(path: string, body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidGatewayUrl}/${path}`, body);
  }

  // ── Orders info ────────────────────────────────────────────────────────────

  getOrderStatus(oid: number): Observable<HLOrderStatusResponse> {
    return this.http.get<HLOrderStatusResponse>(
      `${this.config.hyperliquidGatewayUrl}/hyperliquid/orders/open/${oid}`,
    );
  }

  // ── Trade actions ──────────────────────────────────────────────────────────

  cancelOrder(
    cancels: Array<{ asset: number; oid: HLOid }>,
    isTestnet = false,
  ): Observable<HLSuccessResponse<HLCancelOrderResponse>> {
    return this.post<HLSuccessResponse<HLCancelOrderResponse>>('hyperliquid/order/cancel', {
      cancels,
      isTestnet,
    });
  }

  placeOrder(
    order: HLOrderDetails,
    grouping: HLOrderGrouping = 'na',
    isTestnet = false,
  ): Observable<HLSuccessResponse<HLPlaceOrderResponse>> {
    return this.post<HLSuccessResponse<HLPlaceOrderResponse>>('hyperliquid/order', {
      order,
      grouping,
      isTestnet,
    });
  }

  modifyOrder(
    oid: HLOid,
    order: HLOrderDetails,
    isTestnet = false,
  ): Observable<HLSuccessResponse<HLPlaceOrderResponse>> {
    return this.post<HLSuccessResponse<HLPlaceOrderResponse>>('hyperliquid/order/modify', {
      oid,
      order,
      isTestnet,
    });
  }

  // TODO
  // POST 'hyperliquid/orders'
  // HLOrderDetails[]

  // TODO
  // updateLeverage
  // POST 'hyperliquid/leverage'
  // UpdateLeverageParams
  // return HLSuccessResponse
}
