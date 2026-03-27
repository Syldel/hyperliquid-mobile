import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BotSettings, User } from '@models/user.interface';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  getMe() {
    return this.http.get<User>(`${this.config.userServiceUrl}/auth/me`);
  }

  updateStrategy(tradingSettings: Record<string, BotSettings>) {
    return this.http.patch<User>(`${this.config.userServiceUrl}/auth/strategy`, tradingSettings);
  }
}
