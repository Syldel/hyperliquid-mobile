import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Platform } from '@ionic/angular';
import { ConfigService } from '@services/config.service';
import { PreferencesService } from '@services/preferences.service';
import { ThemeService } from '@services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  standalone: true,
})
export class App {
  constructor(
    private readonly platform: Platform,
    private readonly themeService: ThemeService,
    private readonly configService: ConfigService,
    private readonly preferencesService: PreferencesService,
  ) {
    this.platform.ready().then(() => this.initializeApp());
  }

  async initializeApp() {
    await this.themeService.initialize();
    await this.configService.loadConfig();
    await this.preferencesService.loadPreferences();
  }
}
