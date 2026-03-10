import { Component, input, output } from '@angular/core';
import {
  IonBackButton,
  IonButtons,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

type StartButtonType = 'menu' | 'back' | 'none';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonBackButton],
  template: `
    <ion-header [translucent]="translucent()">
      <ion-toolbar [color]="color()">
        <ion-buttons slot="start">
          @switch (startButton()) {
            @case ('menu') {
              <ion-menu-button></ion-menu-button>
            }
            @case ('back') {
              <ion-back-button
                [defaultHref]="defaultHref()"
                (click)="backClick.emit()"
              ></ion-back-button>
            }
            @case ('none') {}
          }
        </ion-buttons>

        <ion-title>{{ title() }}</ion-title>

        @if (hasEndButtons()) {
          <ion-buttons slot="end">
            <ng-content select="[slot=end]"></ng-content>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>
  `,
  styleUrls: ['./page-header.component.scss'],
})
export class PageHeaderComponent {
  // Inputs
  title = input.required<string>();
  translucent = input<boolean>(false);
  color = input<string | undefined>(undefined);
  startButton = input<StartButtonType>('menu');
  defaultHref = input<string>('/');
  hasEndButtons = input<boolean>(false);

  // Outputs
  backClick = output<void>();
}
