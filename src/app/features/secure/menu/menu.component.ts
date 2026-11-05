import { Component, computed, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@auth/auth.service';
import { AgentStatusService } from '@services/agent-status.service';
import {
  IonButton,
  IonContent,
  IonFooter,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenu,
  IonRouterOutlet,
  MenuController,
} from '@ionic/angular/standalone';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { UserAvatarBtnComponent } from '@shared/components/user-avatar-btn/user-avatar-btn.component';
import { VersionMismatchBannerComponent } from '@shared/components/version-mismatch-banner/version-mismatch-banner.component';
import { addIcons } from 'ionicons';
import {
  analyticsOutline,
  gitBranchOutline,
  hardwareChipOutline,
  homeOutline,
  keyOutline,
  listOutline,
  lockClosedOutline,
  logOutOutline,
  pieChartOutline,
  pulseOutline,
  receiptOutline,
  settingsOutline,
  statsChartOutline,
  swapHorizontalOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [
    IonContent,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonMenu,
    IonRouterOutlet,
    IonFooter,
    IonButton,
    UserAvatarBtnComponent,
    PageHeaderComponent,
    VersionMismatchBannerComponent,
  ],
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
})
export class MenuComponent implements OnInit {
  private readonly menuCtrl = inject(MenuController);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly isLoggedIn = computed(() => this.authService.isLoggedIn());

  private readonly agentStatus = inject(AgentStatusService).status;

  /**
   * `Agent · 42 d`, ou ce qui ne va pas. Rien tant que l'agent n'est pas lu :
   * hors connexion, ou pendant la lecture qui suit la connexion.
   */
  readonly agentLine = computed(() => {
    const status = this.agentStatus();
    switch (status.kind) {
      case 'loading':
        return null;
      case 'valid':
        return { level: status.level, text: `Agent · ${status.remaining}` };
      case 'expired':
        return { level: status.level, text: 'Agent · expired' };
      case 'missing':
        return { level: status.level, text: 'Agent · unknown expiry' };
      case 'unavailable':
        return { level: status.level, text: 'Agent · status unavailable' };
    }
  });

  constructor() {
    addIcons({
      gitBranchOutline,
      homeOutline,
      logOutOutline,
      statsChartOutline,
      receiptOutline,
      pieChartOutline,
      settingsOutline,
      hardwareChipOutline,
      analyticsOutline,
      lockClosedOutline,
      pulseOutline,
      listOutline,
      swapHorizontalOutline,
      keyOutline,
    });
  }

  ngOnInit() {
    this.menuCtrl.enable(true);
  }

  onMenuItemClick(path: string) {
    this.router.navigate([path]);
    this.menuCtrl.close('main-menu');
  }

  /** Revient à la liste des wallets ; les jetons restent (voir AuthService). */
  async switchWallet() {
    await this.authService.switchWallet();
    this.router.navigate(['/auth/login']);
  }

  /** Supprime le jeton du wallet courant, puis revient à la liste. */
  async signOut() {
    await this.authService.signOut();
    this.router.navigate(['/auth/login']);
  }
}
