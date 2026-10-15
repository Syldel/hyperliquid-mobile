import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  ActionSheetController,
  AlertController,
  IonButton,
  IonFab,
  IonFabButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { RefreshableLayoutComponent } from '@shared/components/refreshable-layout/refreshable-layout.component';
import { addIcons } from 'ionicons';
import { addOutline, clipboardOutline, copyOutline, ellipsisHorizontal } from 'ionicons/icons';
import { branchSummary as summariseBranches } from '../../domain/strategy-summary.util';
import { StrategyBuilderModalComponent } from '../../components/strategy-builder-modal/strategy-builder-modal.component';
import { type StrategyDocument } from '../../models/strategy-document.model';
import {
  StrategyLibraryService,
  generateStrategyId,
} from '../../services/strategy-library.service';
import {
  documentsToWrite,
  exportStrategies,
  parseStrategyTransfer,
  planImport,
  type ImportDecision,
} from '../../domain/strategy-transfer.util';

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
    IonButton,
  ],
  templateUrl: './strategies.page.html',
  styleUrls: ['./strategies.page.scss'],
})
export class StrategiesPage {
  private readonly library = inject(StrategyLibraryService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  readonly documents = signal<StrategyDocument[]>([]);
  readonly fetchFn = signal(() => this.library.load());

  constructor() {
    addIcons({ addOutline, ellipsisHorizontal, copyOutline, clipboardOutline });
  }

  onDataLoaded(documents: StrategyDocument[]): void {
    this.documents.set(documents);
  }

  /**
   * Redemande la liste **à la mise en page**, jamais à soi-même.
   *
   * `RefreshableLayoutComponent` garde sa propre copie des données, et c'est
   * elle qui choisit entre « No strategy yet » et le contenu projeté
   * (`@if (!isEmpty())`). Écrire dans `documents` sans la prévenir laissait donc
   * la page vide après la création de la **première** stratégie : la liste était
   * bien construite, mais sous un `@if` resté faux, et seul un tirer-pour-
   * rafraîchir la faisait apparaître. Même défaut en miroir à la suppression de
   * la dernière, où le message d'absence ne revenait pas.
   *
   * Remplacer `fetchFn` relance l'effet de la mise en page, qui recharge et
   * réémet `dataLoaded` — une seule source de vérité, et l'idiome déjà employé
   * par `open-orders` après une action.
   */
  private reload(): void {
    this.fetchFn.set(() => this.library.load());
  }

  /** Libellés des branches réellement renseignées — résumé tenant sur une ligne. */
  branchSummary(document: StrategyDocument): string {
    return summariseBranches(document.rules);
  }

  /**
   * La création écrit **avant** d'ouvrir l'éditeur : si la bibliothèque ne peut
   * pas prendre le document, ouvrir une modale sur un brouillon qui n'existe
   * nulle part ne ferait que retarder la mauvaise nouvelle.
   */
  async create(): Promise<void> {
    try {
      const document = await this.library.create('New strategy');
      await this.openBuilder(document);
    } catch {
      await this.toast('Could not create the strategy — the library could not be written.');
    }
  }

  async openBuilder(document: StrategyDocument): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: StrategyBuilderModalComponent,
      componentProps: { initialDocument: () => document },
    });
    await modal.present();
    await modal.onDidDismiss();

    this.reload();
  }

  async openActions(document: StrategyDocument, event: Event): Promise<void> {
    event.stopPropagation();

    const sheet = await this.actionSheetCtrl.create({
      header: document.name,
      buttons: [
        { text: 'Duplicate', role: 'duplicate' },
        { text: 'Copy as JSON', role: 'copy' },
        { text: 'Delete', role: 'destructive' },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();

    const { role } = await sheet.onDidDismiss();

    // La copie ne touche pas la bibliothèque : elle a son propre compte rendu,
    // et elle n'a rien à faire dans le `try` qui garde les écritures.
    if (role === 'copy') {
      await this.copy([document], `“${document.name}”`);
      return;
    }

    try {
      if (role === 'duplicate') await this.library.duplicate(document.id);
      if (role === 'destructive') await this.library.remove(document.id);
    } catch {
      // Sans ça, la liste se redessinait inchangée et le geste paraissait
      // simplement ignoré — le pire des deux, puisqu'une suppression qui semble
      // avoir eu lieu se refait.
      await this.toast('Nothing changed — the library could not be written.');
    }

    this.reload();
  }

  // ── Transfert par le presse-papier ────────────────────────────────────────

  /**
   * Copie une stratégie, ou toute la bibliothèque, en JSON.
   *
   * ⚠️ `writeText` peut être refusé — contexte non sécurisé, permission niée.
   * L'échec est **dit** : un bouton « Copy » qui ne copie rien et ne proteste
   * pas laisserait coller l'ancien contenu du presse-papier dans une IA, ou
   * croire la sauvegarde faite.
   */
  async copy(documents: readonly StrategyDocument[], what: string): Promise<void> {
    if (documents.length === 0) {
      await this.toast('Nothing to copy — the library is empty.');
      return;
    }

    try {
      await navigator.clipboard.writeText(exportStrategies(documents));
    } catch {
      await this.toast('The clipboard refused the copy — nothing was written to it.');
      return;
    }

    await this.toast(`${what} copied as JSON.`, 'success');
  }

  copyAll(): Promise<void> {
    const documents = this.documents();
    return this.copy(
      documents,
      documents.length === 1 ? '1 strategy' : `${documents.length} strategies`,
    );
  }

  /**
   * Importe ce que l'utilisateur colle.
   *
   * Le texte est **saisi dans une alerte** plutôt que lu par
   * `navigator.clipboard.readText()` : la lecture du presse-papier demande une
   * permission que bien des contextes refusent, et un import qui échoue au
   * moment précis où on veut récupérer ses stratégies serait le pire endroit
   * pour dépendre d'elle. Une zone de texte marche partout.
   */
  async pasteImport(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Import strategies',
      message: 'Paste the JSON of one strategy, or of a whole library export.',
      inputs: [{ name: 'json', type: 'textarea', placeholder: '{ "name": …, "rules": … }' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Import', role: 'confirm' },
      ],
    });
    await alert.present();

    const { data, role } = await alert.onDidDismiss<{ values?: { json?: string } }>();
    if (role !== 'confirm') return;

    const text = data?.values?.json?.trim() ?? '';
    if (!text) {
      await this.toast('Nothing was pasted.');
      return;
    }

    const { documents, problems } = parseStrategyTransfer(text, generateStrategyId);
    const decisions = planImport(documents, this.documents(), generateStrategyId);

    try {
      const toWrite = documentsToWrite(decisions);
      if (toWrite.length > 0) await this.library.importMissing(toWrite);
    } catch {
      await this.toast('Nothing changed — the library could not be written.');
      return;
    }

    this.reload();
    await this.toast(
      importSummary(decisions, problems),
      problems.length > 0 ? 'warning' : 'success',
    );
  }

  private async toast(
    message: string,
    color: 'danger' | 'success' | 'warning' = 'danger',
  ): Promise<void> {
    const toast = await this.toastCtrl.create({ message, color, duration: 4000 });
    await toast.present();
  }
}

/**
 * Ce que l'import a fait, en une phrase.
 *
 * Chaque sort est compté séparément, et les refus sont **nommés** : un
 * « imported 2 of 3 » laisserait chercher laquelle manque et pourquoi.
 */
export function importSummary(
  decisions: readonly ImportDecision[],
  problems: readonly string[],
): string {
  const count = (outcome: ImportDecision['outcome']) =>
    decisions.filter((decision) => decision.outcome === outcome).length;

  const parts: string[] = [];
  const added = count('added');
  const copied = count('copied');
  const present = count('already-present');

  if (added > 0) parts.push(`${added} imported`);
  if (copied > 0) parts.push(`${copied} kept as a copy, their id was taken`);
  if (present > 0) parts.push(`${present} already there`);
  if (parts.length === 0) parts.push('Nothing imported');

  return problems.length === 0
    ? `${parts.join(', ')}.`
    : `${parts.join(', ')}. ${problems.join(' ')}`;
}
