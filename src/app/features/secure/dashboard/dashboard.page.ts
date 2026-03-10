import { Component } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { LiquidLoaderComponent } from '@shared/components/liquid-loader/liquid-loader.component';
import { LiquidSpinnerComponent } from '@shared/components/liquid-spinner/liquid-spinner.component';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [IonContent, LiquidLoaderComponent, LiquidSpinnerComponent, PageHeaderComponent],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage extends MenuBasePage {}
