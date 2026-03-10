import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  ModalController,
} from '@ionic/angular/standalone';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { LoginModalPage } from '@shared/components/login-modal/login-modal.page';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { addIcons } from 'ionicons';
import { logInOutline } from 'ionicons/icons';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    IonContent,
    IonButton,
    IonItem,
    IonLabel,
    IonBadge,
    IonIcon,
    IonList,
    IonNote,
    DatePipe,
    PageHeaderComponent,
  ],
  templateUrl: './profile.page.html',
})
export class ProfilePage extends MenuBasePage {
  private readonly modalCtrl = inject(ModalController);

  readonly isLoggedIn = computed(() => this.authService.isLoggedIn());
  readonly currentUser = computed(() => this.authService.currentWallet());

  ngOnInit(): void {
    addIcons({
      logInOutline,
    });
  }

  async openLoginModal() {
    const modal = await this.modalCtrl.create({
      component: LoginModalPage,
      cssClass: 'login-modal',
    });

    await modal.present();
  }
}
