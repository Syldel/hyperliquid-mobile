import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@auth/auth.service';
import {
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenu,
  IonRouterOutlet,
  IonTitle,
  IonToolbar,
  MenuController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
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
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonMenu,
    IonRouterOutlet,
    IonTitle,
    IonToolbar,
    IonFooter,
  ],
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
})
export class MenuComponent implements OnInit {
  private readonly menuCtrl = inject(MenuController);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    addIcons({
      homeOutline,
      logOutOutline,
      statsChartOutline,
      receiptOutline,
      pieChartOutline,
      settingsOutline,
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
