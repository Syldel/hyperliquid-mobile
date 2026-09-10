import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkOutline } from 'ionicons/icons';
import { strategyColor } from '../../domain/strategy-color.util';
import { branchSummary as summariseBranches } from '../../domain/strategy-summary.util';
import { type StrategyDocument } from '../../models/strategy-document.model';
import { StrategyLibraryService } from '../../services/strategy-library.service';

/**
 * Choix des stratégies de la bibliothèque.
 *
 * Renvoie la liste complète des identifiants cochés, pas un delta : l'appelant
 * n'a pas à reconstituer ce qui a été ajouté ou retiré, il remplace. En mode
 * `multiple` (un chart, qui superpose plusieurs stratégies) la sélection se
 * valide explicitement ; sinon (une paire du bot, qui n'en exécute qu'une) un
 * appui vaut choix et referme, et le tableau renvoyé n'a qu'un élément.
 */
@Component({
  selector: 'app-strategy-picker-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonIcon,
    IonLabel,
    IonNote,
    IonCheckbox,
  ],
  templateUrl: './strategy-picker-modal.component.html',
  styleUrls: ['./strategy-picker-modal.component.scss'],
})
export class StrategyPickerModalComponent implements OnInit {
  readonly attachedIds = input<readonly string[]>([]);
  /** `false` pour n'en choisir qu'une : l'appui vaut alors validation. */
  readonly multiple = input(true);

  private readonly library = inject(StrategyLibraryService);
  private readonly modalCtrl = inject(ModalController);

  readonly documents = signal<StrategyDocument[]>([]);
  readonly selected = signal<ReadonlySet<string>>(new Set());

  constructor() {
    addIcons({ checkmarkOutline });
  }

  async ngOnInit(): Promise<void> {
    this.documents.set(await this.library.load());
    this.selected.set(new Set(this.attachedIds()));
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggle(id: string): void {
    if (!this.multiple()) {
      this.modalCtrl.dismiss([id], 'confirm');
      return;
    }

    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  colorOf(id: string): string {
    return strategyColor(id);
  }

  /** Branches réellement renseignées — le même résumé que la page bibliothèque. */
  branchSummary(document: StrategyDocument): string {
    return summariseBranches(document.rules);
  }

  confirm(): void {
    this.modalCtrl.dismiss([...this.selected()], 'confirm');
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
