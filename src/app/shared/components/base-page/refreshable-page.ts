import { inject, Injectable, OnInit, signal } from '@angular/core';
import { IonRefresher, IonRefresherContent, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { alertCircleOutline } from 'ionicons/icons';
import { firstValueFrom, Observable } from 'rxjs';
import { MenuBasePage } from './menu-base-page';

export const REFRESHABLE_PAGE_IMPORTS = [IonRefresher, IonRefresherContent] as const;

@Injectable()
export abstract class RefreshablePage<T> extends MenuBasePage implements OnInit {
  private readonly toastController = inject(ToastController);

  data = signal<T | null>(null);
  isLoading = signal(false);

  abstract fetch(): Promise<T> | Observable<T>;

  async ngOnInit() {
    addIcons({ alertCircleOutline });
    await this.load();
  }

  async onRefresh(event: CustomEvent) {
    await this.load();
    (event.target as HTMLIonRefresherElement).complete();
  }

  private async load() {
    this.isLoading.set(true);
    try {
      const result = await this.toPromise(this.fetch());
      this.data.set(result);
    } catch (e) {
      await this.showErrorToast();
    } finally {
      this.isLoading.set(false);
    }
  }

  private toPromise<T>(value: Promise<T> | Observable<T>): Promise<T> {
    if (value instanceof Observable) {
      return firstValueFrom(value);
    }
    return value;
  }

  private async showErrorToast() {
    const toast = await this.toastController.create({
      message: 'An error occurred while loading data',
      duration: 3000,
      color: 'danger',
      position: 'bottom',
      icon: 'alert-circle-outline',
    });
    await toast.present();
  }
}
