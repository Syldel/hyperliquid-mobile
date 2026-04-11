import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { AuthService } from '@auth/auth.service';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  fileTrayOutline,
  lockClosedOutline,
  logInOutline,
} from 'ionicons/icons';
import { firstValueFrom, Observable } from 'rxjs';
import { LoginModalPage } from '../login-modal/login-modal.page';
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
    IonButton,
    IonNote,
  ],
  templateUrl: './refreshable-layout.component.html',
  styleUrls: ['./refreshable-layout.component.scss'],
})
export class RefreshableLayoutComponent<T> {
  private readonly toastController = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly authService = inject(AuthService);
  private readonly lifecycle = inject(AppLifecycleService);

  title = input.required<string>();
  fetchFn = input.required<() => Promise<T> | Observable<T>>();
  emptyIcon = input<string>('file-tray-outline');
  emptyMessage = input<string>('No data found');
  requiresAuth = input<boolean>(false);

  dataLoaded = output<T>();

  data = signal<T | null>(null);
  isLoading = signal(false);
  isRefreshing = signal(false);

  readonly isLoggedIn = computed(() => this.authService.isLoggedIn());

  constructor() {
    effect(() => {
      this.fetchFn();
      this.lifecycle.foregroundCount();
      if (this.requiresAuth() && !this.authService.isLoggedIn()) return;
      untracked(() => this.load(false));
    });
  }

  async ngOnInit() {
    addIcons({ fileTrayOutline, alertCircleOutline, lockClosedOutline, logInOutline });
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

  async openLoginModal() {
    const modal = await this.modalCtrl.create({
      component: LoginModalPage,
      cssClass: 'login-modal',
    });

    await modal.present();

    modal.onDidDismiss().then((result) => {
      if (result.data) {
        this.load(false);
      }
    });
  }
}
