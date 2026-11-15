import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  contentChild,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
  TemplateRef,
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
import { PageHeaderComponent, StartButtonType } from '../page-header/page-header.component';

export interface PageHeaderParams {
  startButton?: StartButtonType;
  defaultHref?: string;
}

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
    NgTemplateOutlet,
  ],
  templateUrl: './refreshable-layout.component.html',
  styleUrls: ['./refreshable-layout.component.scss'],
})
export class RefreshableLayoutComponent<T> implements OnInit {
  private readonly toastController = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly authService = inject(AuthService);
  private readonly lifecycle = inject(AppLifecycleService);

  title = input.required<string>();
  /**
   * Ce que la page charge. `null` : elle ne sait pas encore **quoi** charger — Open Orders et Perp
   * Summary attendent la sélection des dex, lue dans le stockage. Le layout montre alors son indicateur
   * de chargement et ne charge rien.
   *
   * Ces pages rendaient jusqu'au 2026-11-15 un `of([])` d'attente, que le layout prenait pour une
   * réponse : « No open order found » s'affichait tant que le stockage n'avait pas répondu — 150 ms
   * mesurées en ralentissant le stockage d'autant, alors que le compte avait deux ordres ouverts.
   */
  fetchFn = input.required<(() => Promise<T> | Observable<T>) | null>();
  /**
   * Ce que fait le tirer-pour-rafraîchir, s'il doit faire plus que `fetchFn` — passer les caches, par
   * exemple (watchlist-detail). Sans lui, le geste rappelle `fetchFn`, comme avant.
   */
  refreshFn = input<(() => Promise<T> | Observable<T>) | null>(null);
  emptyIcon = input<string>('file-tray-outline');
  emptyMessage = input<string>('No data found');
  requiresAuth = input<boolean>(false);
  pageHeaderParams = input<PageHeaderParams>({});

  dataLoaded = output<T>();

  data = signal<T | null>(null);
  isLoading = signal(false);
  isRefreshing = signal(false);

  /** En chargement, ou en attente de savoir quoi charger : dans les deux cas, rien à affirmer encore. */
  readonly showSpinner = computed(() => this.isLoading() || this.fetchFn() === null);

  readonly isLoggedIn = computed(() => this.authService.isLoggedIn());

  readonly endButtonsTpl = contentChild<TemplateRef<unknown>>('endButtons');

  constructor() {
    effect(() => {
      const fn = this.fetchFn();
      this.lifecycle.foregroundCount();
      if (fn === null) return;
      if (this.requiresAuth() && !this.authService.isLoggedIn()) return;
      untracked(() => this.load(false, fn));
    });
  }

  async ngOnInit() {
    addIcons({ fileTrayOutline, alertCircleOutline, lockClosedOutline, logInOutline });
  }

  async onRefresh(event: CustomEvent) {
    const fn = this.refreshFn() ?? this.fetchFn();
    // Rien à relire tant que la page ne sait pas quoi charger : le chargement partira de lui-même.
    if (fn !== null) await this.load(true, fn);
    (event.target as HTMLIonRefresherElement).complete();
  }

  isEmpty(): boolean {
    const d = this.data();
    return Array.isArray(d) ? d.length === 0 : d === null;
  }

  /**
   * Numéro du dernier chargement lancé. Seul celui-là a le droit de s'afficher.
   *
   * Deux chargements peuvent être en vol à la fois : un changement de dex pendant une lecture lente, un
   * retour au premier plan pendant un tirer-pour-rafraîchir. Les réponses s'appliquaient dans leur
   * **ordre d'arrivée** : mesuré le 2026-11-15 sur Open Orders, une lecture lente de l'ancienne
   * sélection (800 ms) lancée 50 ms avant une rapide de la nouvelle (100 ms) remplaçait celle-ci à
   * l'écran, sous le sélecteur qui affichait la nouvelle — et sans le moindre signe. Le premier fini
   * éteignait aussi l'indicateur, alors que l'autre était encore en cours. Même garde que le `loadToken`
   * du chart de watchlist-detail.
   */
  private loadToken = 0;

  private async load(isRefresh: boolean, fn: () => Promise<T> | Observable<T>) {
    const token = ++this.loadToken;
    if (isRefresh) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }

    try {
      const result = await this.toPromise(fn());
      // Dépassé : une réponse plus récente est attendue, ou déjà affichée.
      if (token !== this.loadToken) return;
      this.data.set(result);
      this.dataLoaded.emit(result);
    } catch (e) {
      if (token !== this.loadToken) {
        // Son résultat n'aurait pas été affiché : pas de toast, mais une trace.
        console.warn('[RefreshableLayout] superseded load failed', e);
        return;
      }
      // Le toast dit « ça a échoué », jamais pourquoi : sans cette ligne la cause
      // (réseau, 401, réponse illisible) n'existait nulle part.
      console.error('[RefreshableLayout] load failed', e);
      await this.showErrorToast();
    } finally {
      // Seul le dernier chargement rend la main : éteindre l'indicateur plus tôt ferait lire comme
      // définitif ce qu'un chargement encore en cours va remplacer.
      if (token === this.loadToken) {
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      }
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
      const fn = this.fetchFn();
      if (result.data && fn !== null) {
        this.load(false, fn);
      }
    });
  }
}
