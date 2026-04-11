import { Component, effect, inject, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '@auth/auth.service';
import { Platform } from '@ionic/angular';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { ConfigService } from '@services/config.service';
import { PreferencesService } from '@services/preferences.service';
import { ThemeService } from '@services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  standalone: true,
})
export class AppComponent {
  private readonly platform = inject(Platform);
  private readonly themeService = inject(ThemeService);
  private readonly configService = inject(ConfigService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly authService = inject(AuthService);
  private readonly lifecycleService = inject(AppLifecycleService);

  constructor() {
    effect(() => {
      if (this.lifecycleService.isActive()) {
        untracked(() => this.authService.scheduleAutoLogout());
      }
    });

    this.platform.ready().then(() => this.initializeApp());
  }

  private async initializeApp(): Promise<void> {
    try {
      await this.themeService.initialize();
      await this.configService.loadConfig();
      await this.preferencesService.loadPreferences();
    } catch (error) {
      console.error('[AppComponent] initializeApp failed', error);
    }
  }
}
