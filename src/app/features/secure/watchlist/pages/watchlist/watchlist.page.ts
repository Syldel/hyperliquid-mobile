import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  IonFab,
  IonFabButton,
  IonIcon,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { AppLifecycleService } from '@services/app-lifecycle.service';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { AddWatchlistModalComponent } from '../../components/add-watchlist-modal/add-watchlist-modal.component';
import { WatchlistCardComponent } from '../../components/watchlist-card/watchlist-card.component';
import { WatchlistItem } from '../../models/watchlist-item.model';
import { WatchlistService } from '../../services/watchlist.service';

@Component({
  selector: 'app-watchlist',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RefreshableLayoutComponent, WatchlistCardComponent, IonFab, IonFabButton, IonIcon],
  templateUrl: './watchlist.page.html',
  styleUrls: ['./watchlist.page.scss'],
})
export class WatchlistPage {
  private readonly watchlistService = inject(WatchlistService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly lifecycle = inject(AppLifecycleService);
  private readonly router = inject(Router);

  items = signal<WatchlistItem[]>([]);

  fetchFn = signal(this.buildFetchFn());

  constructor() {
    addIcons({ addOutline });

    effect(() => {
      this.lifecycle.foregroundCount();
      untracked(() => this.fetchFn.set(this.buildFetchFn()));
    });
  }

  onDataLoaded(data: WatchlistItem[]): void {
    this.items.set(data);
  }

  async openAddModal(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: AddWatchlistModalComponent,
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<{ coin: string; interval: any }>();
    if (role !== 'confirm' || !data) return;

    // Le succès s'annonçait avant d'être acquis : sans wallet, l'écriture
    // sortait en silence et « added to watchlist » s'affichait quand même.
    try {
      await this.watchlistService.add(data.coin, data.interval);
    } catch {
      await this.showToast('Could not add the pair — nothing was written.', 'danger');
      return;
    }

    this.fetchFn.set(this.buildFetchFn());
    this.showToast(`${data.coin} added to watchlist`);
  }

  async onRemove(coin: string): Promise<void> {
    const item = this.watchlistService.getByCoin(coin);

    try {
      await this.watchlistService.remove(coin);
    } catch {
      // Sans ça, la liste se redessinait inchangée et le geste paraissait
      // ignoré — une suppression qui semble ne pas avoir pris se refait.
      await this.showToast('Could not remove the pair — nothing was written.', 'danger');
      return;
    }

    this.fetchFn.set(this.buildFetchFn());
    if (item) this.showToast(`${item.coin} removed`);
  }

  async onItemUpdated(data: { coin: string } & Partial<WatchlistItem>): Promise<void> {
    const { coin, ...changes } = data;

    try {
      await this.watchlistService.update(coin, changes);
    } catch {
      await this.showToast('Change not saved — nothing was written.', 'danger');
      return;
    }

    this.fetchFn.set(this.buildFetchFn());
  }

  private buildFetchFn() {
    return async () => {
      await this.watchlistService.load();
      return this.watchlistService.items();
    };
  }

  private async showToast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: color === 'danger' ? 4000 : 2000,
      position: 'bottom',
      color,
    });
    await toast.present();
  }

  navigateToDetail(coin: string): void {
    this.router.navigate(['/secure/watchlist/detail', coin]);
  }
}
