import { Component } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';

@Component({
  selector: 'app-balances',
  standalone: true,
  imports: [IonContent, PageHeaderComponent],
  templateUrl: './balances.page.html',
})
export class BalancesPage extends MenuBasePage {}
