import { Component, computed, inject } from '@angular/core';
import {
  IonContent,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonSelect,
  IonSelectOption,
  IonToggle,
} from '@ionic/angular/standalone';
import { SmartDecimalPipe } from '@pipes/smart-decimal.pipe';
import { PreferencesService } from '@services/preferences.service';
import { ThemeService } from '@services/theme.service';
import { MenuBasePage } from '@shared/components/base-page/menu-base-page';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonToggle,
    IonLabel,
    IonSelect,
    IonSelectOption,
    PageHeaderComponent,
    SmartDecimalPipe,
  ],
  templateUrl: './settings.page.html',
})
export class SettingsPage extends MenuBasePage {
  private readonly themeService = inject(ThemeService);
  private readonly preferences = inject(PreferencesService);

  previewValues = [1234567.89, 0.00042, 42.5];

  isDarkMode = computed(() => {
    return this.themeService.isDarkMode();
  });

  locale = computed(() => {
    return this.preferences.locale();
  });

  async toggleChange(event: CustomEvent) {
    const isDark = event.detail.checked;
    await this.themeService.toggleTheme(isDark);
  }

  localeChange(event: CustomEvent) {
    this.preferences.updatePreferences({ locale: event.detail.value });
  }
}
