import { Component, computed, inject } from '@angular/core';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  ModalController,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { LoginModalPage } from '@shared/components/login-modal/login-modal.page';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { addIcons } from 'ionicons';
import { logInOutline } from 'ionicons/icons';
import { TokenExpiryComponent } from './components/token-expiry.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    IonContent,
    IonButton,
    IonItem,
    IonLabel,
    IonIcon,
    IonList,
    IonNote,
    PageHeaderComponent,
    TokenExpiryComponent,
  ],
  templateUrl: './profile.page.html',
})
export class ProfilePage extends MenuBasePage {
  private readonly modalCtrl = inject(ModalController);
  private readonly lifecycle = inject(AppLifecycleService);

  readonly isLoggedIn = computed(() => {
    this.lifecycle.foregroundCount();
    return this.authService.isLoggedIn();
  });
  readonly currentUser = computed(() => {
    this.lifecycle.foregroundCount();
    return this.authService.currentWallet();
  });

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
