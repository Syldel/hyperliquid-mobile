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

@Component({
  selector: 'app-balances',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonMenuButton, IonButtons],
  templateUrl: './balances.page.html',
})
export class BalancesPage extends MenuBasePage {}
