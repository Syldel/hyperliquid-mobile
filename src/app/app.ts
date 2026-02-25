import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Platform } from '@ionic/angular';
import { ConfigService } from './core/services/config.service';
import { ThemeService } from './core/services/theme.service';

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
  ) {
    this.platform.ready().then(() => this.initializeApp());
  }

  async initializeApp() {
    await this.themeService.initialize();
    await this.configService.loadConfig();
  }
}
