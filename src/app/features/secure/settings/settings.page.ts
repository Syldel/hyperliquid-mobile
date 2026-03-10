import { Component, computed, inject } from '@angular/core';
import { IonContent, IonItem, IonList, IonListHeader, IonToggle } from '@ionic/angular/standalone';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ThemeService } from 'app/core/services/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IonContent, IonList, IonListHeader, IonItem, IonToggle, PageHeaderComponent],
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
