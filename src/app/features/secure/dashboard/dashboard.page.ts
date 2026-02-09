import { Component } from '@angular/core';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { LiquidLoaderComponent } from '@shared/components/liquid-loader/liquid-loader.component';
import { LiquidSpinnerComponent } from '@shared/components/liquid-spinner/liquid-spinner.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonMenuButton,
    IonButtons,
    LiquidLoaderComponent,
    LiquidSpinnerComponent,
  ],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage extends MenuBasePage {}
