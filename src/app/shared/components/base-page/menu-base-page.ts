import { Component, inject } from '@angular/core';
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

  ionViewWillEnter() {
    this.menuCtrl.enable(true);
  }
}
