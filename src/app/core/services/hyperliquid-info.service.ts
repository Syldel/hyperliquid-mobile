import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import type {
  CandleSnapshot,
  CandleSnapshotRequest,
  HlActiveAssetData,
  HlUserFees,
  HLClearinghouseState,
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

  getClearinghouseState(dex?: string): Observable<HLClearinghouseState> {
    return this.post<HLClearinghouseState>({
      type: 'clearinghouseState',
      user: this.auth.currentAddress(),
      ...(dex !== undefined && dex !== '' ? { dex } : {}),
    });
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
      ...(dex !== undefined && dex !== '' ? { dex } : {}),
    });
  }

  getFrontendOpenOrders(dex?: string): Observable<HLFrontendOpenOrder[]> {
    return this.post<HLFrontendOpenOrder[]>({
      type: 'frontendOpenOrders',
      user: this.auth.currentAddress(),
      ...(dex !== undefined && dex !== '' ? { dex } : {}),
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

  /**
   * Le barème de frais du compte dont l'adresse est mémorisée.
   *
   * Ici et non via le gateway, parce que `userFees` est une **information**, pas
   * une action : il prend l'adresse en paramètre et ne demande aucune signature.
   * `docs/ecosystem.md` pose la frontière — le gateway sert « ce qui engage un
   * compte », l'API publique sert l'information de marché et de compte, et c'est
   * déjà par elle que cette page lit `userFillsByTime`.
   *
   * La conséquence pratique compte autant que le principe : cette page se
   * consulte **sans jeton valide** (`/secure` est gardé par `WalletGuard`, qui
   * n'exige qu'une adresse mémorisée). Passer par le gateway rendait le bandeau
   * vide dans le mode de fonctionnement normal de l'app.
   *
   * ⚠️ `userCrossRate` et `userAddRate` sont déjà nets du palier de volume sur 14
   * jours et de la remise de staking, mais **pas** de la remise de parrainage ni
   * du barème propre à un marché HIP-3.
   */
  getUserFees(): Observable<HlUserFees> {
    return this.post<HlUserFees>({
      type: 'userFees',
      user: this.auth.currentAddress(),
    });
  }

  getActiveAssetData(coin: string): Observable<HlActiveAssetData> {
    return this.post<HlActiveAssetData>({
      type: 'activeAssetData',
      user: this.auth.currentAddress(),
      coin,
    });
  }
}
