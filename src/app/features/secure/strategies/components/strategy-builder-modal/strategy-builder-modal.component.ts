import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type { LogicalGroup, PublicStrategyValidationIssue } from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import { arrowBackOutline, arrowUndoOutline, chevronForwardOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';
import { locateIssue } from '../../domain/strategy-issues.util';
import { createLogicalGroup } from '../../domain/strategy-node.factory';
import { toLocalIssuePath } from '../../domain/strategy-path.util';
import { getAtPath, isLogicalGroup } from '../../domain/strategy-tree.ops';
import {
  DEFAULT_STRATEGY_BRANCHES,
  toExchangeStrategy,
  type StrategyBranch,
  type StrategyDocument,
} from '../../models/strategy-document.model';
import { StrategyBuilderStore } from '../../services/strategy-builder.store';
import { StrategyLibraryService } from '../../services/strategy-library.service';
import { RuleTreeComponent } from '../rule-tree/rule-tree.component';

/**
 * Éditeur d'une stratégie : son nom, et ses branches de règles.
 *
 * Le store est fourni ici (`providers`) et pas en racine : chaque ouverture
 * repart d'un brouillon propre, et l'arbre récursif y accède par injection
 * plutôt que par une chaîne d'`input`/`output`.
 */
@Component({
  selector: 'app-strategy-builder-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [StrategyBuilderStore],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonNote,
    IonText,
    IonSpinner,
    RuleTreeComponent,
  ],
  templateUrl: './strategy-builder-modal.component.html',
  styleUrls: ['./strategy-builder-modal.component.scss'],
})
export class StrategyBuilderModalComponent implements OnInit {
  readonly initialDocument = input<StrategyDocument | null>(null);
  /** Branches proposées — voir `DEFAULT_STRATEGY_BRANCHES` pour le choix de les passer en entrée. */
  readonly branches = input<readonly StrategyBranch[]>(DEFAULT_STRATEGY_BRANCHES);

  readonly store = inject(StrategyBuilderStore);
  private readonly bot = inject(BotService);
  private readonly library = inject(StrategyLibraryService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  /** Le builder ne peut rien afficher sans la grammaire et le catalogue du bot. */
  readonly metaLoading = signal(true);
  readonly metaFailed = signal(false);
  readonly saving = signal(false);

  /**
   * Anomalies renvoyées par le bot au dernier enregistrement — il fait autorité.
   * Conservées dans le store, que l'arbre consulte pour signaler ses lignes.
   */
  readonly serverIssues = this.store.serverIssues;

  constructor() {
    addIcons({ arrowBackOutline, arrowUndoOutline, chevronForwardOutline });
  }

  ngOnInit(): void {
    const document = this.initialDocument();
    if (document) this.store.open(document);

    this.bot.getExchangeFormMetadata().subscribe({
      next: () => this.metaLoading.set(false),
      error: () => {
        this.metaLoading.set(false);
        this.metaFailed.set(true);
      },
    });
  }

  branchPath(branch: StrategyBranch): string {
    return `rules.${branch.id}`;
  }

  branchGroup(branch: StrategyBranch): LogicalGroup | null {
    const node = getAtPath(this.store.rules(), this.branchPath(branch));
    return isLogicalGroup(node) ? node : null;
  }

  enableBranch(branch: StrategyBranch): void {
    this.store.setBranch(this.branchPath(branch), createLogicalGroup());
  }

  disableBranch(branch: StrategyBranch): void {
    this.store.setBranch(this.branchPath(branch), undefined);
  }

  /**
   * Enregistre le brouillon, puis demande le verdict du bot **quand il y a
   * quelque chose à évaluer**.
   *
   * L'ordre est délibéré : l'enregistrement ne dépend jamais de la validation
   * (un brouillon incomplet reste sauvegardable), mais un désaccord du serveur
   * garde la modale ouverte pour que le rapport soit lu plutôt qu'emporté par
   * la fermeture. Interroger le serveur sur une stratégie que la validation
   * locale sait déjà incomplète n'apprendrait rien : il répéterait les mêmes
   * anomalies de structure.
   */
  async save(): Promise<void> {
    const document = this.store.toDocument();
    if (!document || !this.store.canSave()) return;

    this.saving.set(true);
    this.store.setServerIssues([]);

    try {
      const saved = await this.library.save(document);

      if (!this.store.canAttach()) {
        await this.modalCtrl.dismiss(saved, 'confirm');
        return;
      }

      const result = await firstValueFrom(this.bot.validateStrategy(toExchangeStrategy(saved)));

      if (result.valid) {
        await this.modalCtrl.dismiss(saved, 'confirm');
        return;
      }

      this.store.setServerIssues(result.issues);
      await this.toast('Saved, but the bot rejected these rules — see below.', 'warning');
    } catch {
      // La stratégie est enregistrée quoi qu'il arrive : seul le verdict manque.
      await this.toast('Saved. The bot could not be reached to validate it.', 'warning');
      await this.modalCtrl.dismiss(this.store.toDocument(), 'confirm');
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Chemin de l'anomalie dans le vocabulaire de l'éditeur.
   *
   * Le serveur situe depuis la stratégie entière (`strategy.rules.long…`) ;
   * l'afficher tel quel montrerait à l'utilisateur une racine qui n'existe pas
   * dans ce qu'il édite. Une anomalie hors de l'arbre garde son chemin d'origine
   * — mieux vaut une racine inattendue qu'un chemin muet.
   */
  issuePath(issue: PublicStrategyValidationIssue): string {
    return toLocalIssuePath(issue.path) ?? issue.path;
  }

  /** `true` si l'anomalie désigne un nœud qu'on sait ouvrir. */
  canReveal(issue: PublicStrategyValidationIssue): boolean {
    return locateIssue(this.store.rules(), issue.path) !== null;
  }

  /**
   * Ouvre le groupe qui contient le nœud visé.
   *
   * On ouvre le groupe et non le nœud lui-même : une anomalie désigne souvent un
   * opérande, et le montrer seul le priverait de ce qui le rend lisible — la
   * condition qui l'entoure. La ligne fautive y est signalée par l'arbre.
   */
  revealIssue(issue: PublicStrategyValidationIssue): void {
    const located = locateIssue(this.store.rules(), issue.path);
    if (located) this.store.focus(located.groupPath);
  }

  cancel(): void {
    if (this.store.focusedPath()) {
      this.store.focus(null);
      return;
    }
    this.modalCtrl.dismiss(null, 'cancel');
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, color, duration: 4000 });
    await toast.present();
  }
}
