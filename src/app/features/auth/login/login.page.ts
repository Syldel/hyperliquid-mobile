import { CommonModule } from '@angular/common';
import { Component, computed } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '@auth/auth.service';
import { IonButton, IonContent, IonIcon, ModalController } from '@ionic/angular/standalone';
import { BasePage } from '@shared/components/base-page/base-page';
import { BubbleFooterComponent } from '@shared/components/bubble-footer/bubble-footer.component';
import { LoginModalPage } from '@shared/components/login-modal/login-modal.page';
import { addIcons } from 'ionicons';
import { add, arrowBack, globeOutline } from 'ionicons/icons';
import { ConfigService } from '../../../core/services/config.service';
import { UrlConfigPage } from '../url-config/url-config.page';
import { LoginWallet } from './login-wallet.interface';
import { WalletItemComponent } from './wallet-item/wallet-item.component';

@Component({
  standalone: true,
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    CommonModule,
    WalletItemComponent,
    IonContent,
    IonButton,
    IonIcon,
    BubbleFooterComponent,
  ],
})
export class LoginPage extends BasePage {
  readonly wallets = computed(() => {
    return this.auth.userWallets()?.map((u) => ({ name: u.name, address: u.wallet.publicAddress }));
  });

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly router: Router,
    private readonly modalCtrl: ModalController,
  ) {
    super();
    addIcons({ arrowBack, add, globeOutline });
  }

  async openLoginModal() {
    const modal = await this.modalCtrl.create({
      component: LoginModalPage,
      cssClass: 'login-modal',
    });

    // modal.onDidDismiss().then((result) => {
    //   if (result.data) {
    //     console.log('Login successful:', result.data);
    //     // Handle login success here
    //   }
    // });

    await modal.present();
  }

  onWalletClick(wallet: LoginWallet) {
    console.log('onWalletClick :', wallet);
    this.router.navigate(['/secure']);
  }

  onWalletDelete(wallet: LoginWallet) {
    console.log('onWalletDelete :', wallet);
    // this.wallets.update(current =>
    //   current.filter(w => w.address !== wallet.address)
    // );
  }

  async openUrlConfig() {
    const modal = await this.modalCtrl.create({
      component: UrlConfigPage,
      componentProps: {
        initialConfig: () => this.config.getConfig(),
      },
    });

    modal.onDidDismiss().then((result) => {
      if (result.data) {
        this.config.saveConfig(result.data);
      }
    });

    await modal.present();
  }
}
