import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@auth/auth.service';
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
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly isLoggedIn = computed(() => {
    return this.authService.isLoggedIn();
  });

  constructor() {
    addIcons({ personCircleOutline });
  }

  goToProfile(): void {
    this.router.navigate(['/secure/profile']);
  }
}
