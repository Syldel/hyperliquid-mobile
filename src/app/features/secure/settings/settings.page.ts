import { Component, computed, inject } from '@angular/core';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonList,
  IonListHeader,
  IonMenuButton,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { ThemeService } from 'app/core/services/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonMenuButton,
    IonButtons,
    IonList,
    IonListHeader,
    IonItem,
    IonToggle,
  ],
  templateUrl: './settings.page.html',
})
export class SettingsPage extends MenuBasePage {
  private readonly themeService = inject(ThemeService);

  isDarkMode = computed(() => {
    return this.themeService.isDarkMode();
  });

  async toggleChange(event: CustomEvent) {
    const isDark = event.detail.checked;
    await this.themeService.toggleTheme(isDark);
  }
}
