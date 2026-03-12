import { Component, inject, input, output, signal } from '@angular/core';
import {
  IonContent,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { alertCircleOutline, fileTrayOutline } from 'ionicons/icons';
import { firstValueFrom, Observable } from 'rxjs';
import { PageHeaderComponent } from '../page-header/page-header.component';

@Component({
  selector: 'app-refreshable-layout',
  standalone: true,
  imports: [
    PageHeaderComponent,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonSpinner,
    IonIcon,
  ],
  templateUrl: './refreshable-layout.component.html',
  styleUrls: ['./refreshable-layout.component.scss'],
})
export class RefreshableLayoutComponent<T> {
  private readonly toastController = inject(ToastController);

  title = input.required<string>();
  fetchFn = input.required<() => Promise<T> | Observable<T>>();
  emptyIcon = input<string>('file-tray-outline');
  emptyMessage = input<string>('No data found');

  dataLoaded = output<T>();

  data = signal<T | null>(null);
  isLoading = signal(false);
  isRefreshing = signal(false);

  async ngOnInit() {
    addIcons({ fileTrayOutline, alertCircleOutline });
    await this.load(false);
  }

  async onRefresh(event: CustomEvent) {
    await this.load(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  isEmpty(): boolean {
    const d = this.data();
    return Array.isArray(d) ? d.length === 0 : d === null;
  }

  private async load(isRefresh = false) {
    isRefresh ? this.isRefreshing.set(true) : this.isLoading.set(true);

    try {
      const result = await this.toPromise(this.fetchFn()());
      this.data.set(result);
      this.dataLoaded.emit(result);
    } catch (e) {
      await this.showErrorToast();
    } finally {
      isRefresh ? this.isRefreshing.set(false) : this.isLoading.set(false);
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
