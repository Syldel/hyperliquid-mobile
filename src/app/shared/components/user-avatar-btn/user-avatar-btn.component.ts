import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { personCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-user-avatar-btn',
  standalone: true,
  imports: [CommonModule, IonIcon],
  templateUrl: './user-avatar-btn.component.html',
  styleUrls: ['./user-avatar-btn.component.scss'],
})
export class UserAvatarBtnComponent {
  readonly isLoggedIn = input<boolean>(false);
  readonly profileClick = output<void>();

  constructor() {
    addIcons({ personCircleOutline });
  }
}
