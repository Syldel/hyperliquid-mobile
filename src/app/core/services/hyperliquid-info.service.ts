import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import type {
  CandleSnapshot,
  CandleSnapshotRequest,
  HLFrontendOpenOrder,
  HLOpenOrder,
  HLOrderStatusData,
  HLSpotBalance,
  HLSpotClearinghouseState,
  HLUserFillsByTimeRequest,
  HLUserFillsRequest,
  HLUserFillsResponse,
  PortfolioResponse,
} from '@syldel/hl-shared-types';
import { map, Observable } from 'rxjs';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class HyperliquidInfoService {
  private readonly config = inject(ConfigService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  private post<T>(body: object): Observable<T> {
    return this.http.post<T>(`${this.config.hyperliquidPublicUrl}/info`, body);
  }

  getTokenBalances(): Observable<HLSpotBalance[]> {
    return this.post<HLSpotClearinghouseState>({
      type: 'spotClearinghouseState',
      user: this.auth.currentAddress(),
    }).pipe(map((response) => response.balances));
  }

  getOpenOrders(dex?: string): Observable<HLOpenOrder[]> {
    return this.post<HLOpenOrder[]>({
      type: 'openOrders',
      user: this.auth.currentAddress(),
      ...(dex && { dex }),
    });
  }

  getFrontendOpenOrders(dex?: string): Observable<HLFrontendOpenOrder[]> {
    return this.post<HLFrontendOpenOrder[]>({
      type: 'frontendOpenOrders',
      user: this.auth.currentAddress(),
      ...(dex && { dex }),
    });
  }

  getHistoricalOrders(): Observable<HLOrderStatusData[]> {
    return this.post<HLOrderStatusData[]>({
      type: 'historicalOrders',
      user: this.auth.currentAddress(),
    });
  }

  getPortfolio(): Observable<PortfolioResponse> {
    return this.post<PortfolioResponse>({
      type: 'portfolio',
      user: this.auth.currentAddress(),
    });
  }

  getCandleSnapshot(req: CandleSnapshotRequest): Observable<CandleSnapshot[]> {
    return this.post<CandleSnapshot[]>({
      type: 'candleSnapshot',
      req,
    });
  }

  getUserFills(req?: HLUserFillsRequest): Observable<HLUserFillsResponse> {
    return this.post<HLUserFillsResponse>({
      type: 'userFills',
      user: this.auth.currentAddress(),
      ...req,
    });
  }

  getUserFillsByTime(req: HLUserFillsByTimeRequest): Observable<HLUserFillsResponse> {
    return this.post<HLUserFillsResponse>({
      type: 'userFillsByTime',
      user: this.auth.currentAddress(),
      ...req,
    });
  }
}
