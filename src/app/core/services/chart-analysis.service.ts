import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AnalysisRequest, AnalysisResponse } from '@syldel/trading-shared-types';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class ChartAnalysisService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  /**
   * `fresh` demande au bot de relire les bougies chez Hyperliquid au lieu de servir son cache (un quart
   * d'intervalle : 15 min en 1H, 6 h en 1D). C'est ce qui fait qu'un rafraîchissement forcé l'est
   * vraiment quand des surcouches sont attachées — le cas ordinaire de ce chart.
   *
   * Un champ du corps (`AnalysisRequest.fresh`, types partagés 0.35.0) et non l'en-tête
   * `Cache-Control: no-cache`, essayé puis abandonné le 2026-11-15 avant d'être publié : un bot qui ne
   * connaît pas l'en-tête l'ignore et sert son cache **en silence**, alors qu'un champ inconnu est refusé
   * (`forbidNonWhitelisted`) et l'écran le dit. Ce que la demande a donné se lit ensuite dans
   * `candlesAgeMs`, que vérifie `freshReadWasIgnored`.
   *
   * Le champ n'est envoyé que lorsqu'il vaut `true` : une lecture ordinaire reste la requête d'avant.
   */
  analyze(req: AnalysisRequest, options: { fresh?: boolean } = {}): Observable<AnalysisResponse> {
    const body: AnalysisRequest = options.fresh ? { ...req, fresh: true } : req;
    return this.http.post<AnalysisResponse>(`${this.config.botServiceUrl}/analysis`, body);
  }
}
