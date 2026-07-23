import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ExternalUser } from '@models/user.interface';
import { IExchange } from '@syldel/trading-shared-types';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  getMe() {
    return this.http.get<ExternalUser>(`${this.config.userServiceUrl}/auth/me`);
  }

  updateStrategy(tradingSettings: Record<string, IExchange>) {
    return this.http.patch<ExternalUser>(
      `${this.config.userServiceUrl}/auth/strategy`,
      tradingSettings,
    );
  }
}
