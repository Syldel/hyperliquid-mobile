import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { LoginModalPage } from '@shared/components/login-modal/login-modal.page';
import { addIcons } from 'ionicons';
import { logInOutline } from 'ionicons/icons';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonMenuButton,
    IonButton,
    IonButtons,
    IonItem,
    IonLabel,
    IonBadge,
    IonIcon,
    IonList,
    IonNote,
    DatePipe,
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
