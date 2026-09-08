import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  ActionSheetController,
  IonFab,
  IonFabButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  ModalController,
} from '@ionic/angular/standalone';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { addIcons } from 'ionicons';
import { addOutline, ellipsisHorizontal } from 'ionicons/icons';
import { getAtPath, isLogicalGroup } from '../../domain/strategy-tree.ops';
import { StrategyBuilderModalComponent } from '../../components/strategy-builder-modal/strategy-builder-modal.component';
import {
  DEFAULT_STRATEGY_BRANCHES,
  type StrategyDocument,
} from '../../models/strategy-document.model';
import { StrategyLibraryService } from '../../services/strategy-library.service';

/**
 * Bibliothèque de stratégies : point d'entrée unique pour créer, rouvrir et
 * dupliquer une stratégie.
 *
 * Les charts de la watchlist n'en garderont qu'une référence (`strategyRefs`),
 * jamais une copie — c'est donc ici que vit la seule version de chacune.
 */
@Component({
  selector: 'app-strategies',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RefreshableLayoutComponent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonIcon,
    IonFab,
    IonFabButton,
  ],
  templateUrl: './strategies.page.html',
  styleUrls: ['./strategies.page.scss'],
})
export class StrategiesPage {
  private readonly library = inject(StrategyLibraryService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);

  readonly documents = signal<StrategyDocument[]>([]);
  readonly fetchFn = signal(() => this.library.load());

  constructor() {
    addIcons({ addOutline, ellipsisHorizontal });
  }

  onDataLoaded(documents: StrategyDocument[]): void {
    this.documents.set(documents);
  }

  /** Libellés des branches réellement renseignées — résumé tenant sur une ligne. */
  branchSummary(document: StrategyDocument): string {
    const used = DEFAULT_STRATEGY_BRANCHES.filter((branch) => {
      const group = getAtPath(document.rules, `rules.${branch.id}`);
      return isLogicalGroup(group) && group.conditions.length > 0;
    });

    return used.length > 0 ? used.map((branch) => branch.label).join(' · ') : 'Draft — no rule yet';
  }

  async create(): Promise<void> {
    const document = await this.library.create('New strategy');
    await this.openBuilder(document);
  }

  async openBuilder(document: StrategyDocument): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: StrategyBuilderModalComponent,
      componentProps: { initialDocument: () => document },
    });
    await modal.present();
    await modal.onDidDismiss();

    this.onDataLoaded(await this.library.load());
  }

  async openActions(document: StrategyDocument, event: Event): Promise<void> {
    event.stopPropagation();

    const sheet = await this.actionSheetCtrl.create({
      header: document.name,
      buttons: [
        { text: 'Duplicate', role: 'duplicate' },
        { text: 'Delete', role: 'destructive' },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();

    const { role } = await sheet.onDidDismiss();
    if (role === 'duplicate') await this.library.duplicate(document.id);
    if (role === 'destructive') await this.library.remove(document.id);

    this.onDataLoaded(this.library.documents());
  }
}
