import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ExchangeFormMetadata } from '@models/bot.interfaces';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class BotService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  getExchangeFormMetadata() {
    return this.http.get<ExchangeFormMetadata>(`${this.config.botServiceUrl}/exchanges/meta`);
  }
}
