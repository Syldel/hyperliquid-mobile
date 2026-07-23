import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AnalysisRequest, AnalysisResponse } from '@syldel/trading-shared-types';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class ChartAnalysisService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  analyze(req: AnalysisRequest): Observable<AnalysisResponse> {
    return this.http.post<AnalysisResponse>(`${this.config.botServiceUrl}/analysis`, req);
  }
}
