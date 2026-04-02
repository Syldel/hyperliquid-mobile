import { Component, computed, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@auth/auth.service';
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
import { addIcons } from 'ionicons';
import {
  analyticsOutline,
  hardwareChipOutline,
  homeOutline,
  logOutOutline,
  pieChartOutline,
  receiptOutline,
  settingsOutline,
  statsChartOutline,
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
  ],
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
})
export class MenuComponent implements OnInit {
  private readonly menuCtrl = inject(MenuController);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly isLoggedIn = computed(() => this.authService.isLoggedIn());

  constructor() {
    addIcons({
      homeOutline,
      logOutOutline,
      statsChartOutline,
      receiptOutline,
      pieChartOutline,
      settingsOutline,
      hardwareChipOutline,
      analyticsOutline,
    });
  }

  ngOnInit() {
    this.menuCtrl.enable(true);
  }

  onMenuItemClick(path: string) {
    this.router.navigate([path]);
    this.menuCtrl.close('main-menu');
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
