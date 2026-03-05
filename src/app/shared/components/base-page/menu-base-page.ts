import { Component, inject } from '@angular/core';
import { AuthService } from '@auth/auth.service';
import { MenuController } from '@ionic/angular';
import { BasePage } from './base-page';

@Component({
  template: '',
  standalone: true,
  host: {
    class: 'ion-page',
  },
})
export abstract class MenuBasePage extends BasePage {
  private readonly menuCtrl = inject(MenuController);
  protected readonly authService = inject(AuthService);

  ionViewWillEnter() {
    this.menuCtrl.enable(true);
  }
}
