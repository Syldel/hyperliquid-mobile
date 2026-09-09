import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { strategyColor } from '../../domain/strategy-color.util';
import { getAtPath, isLogicalGroup } from '../../domain/strategy-tree.ops';
import {
  DEFAULT_STRATEGY_BRANCHES,
  type StrategyDocument,
} from '../../models/strategy-document.model';
import { StrategyLibraryService } from '../../services/strategy-library.service';

/**
 * Choix des stratégies de la bibliothèque à attacher à un chart.
 *
 * Renvoie la liste complète des identifiants cochés, pas un delta : l'appelant
 * n'a pas à reconstituer ce qui a été ajouté ou retiré, il remplace.
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
    IonLabel,
    IonNote,
    IonCheckbox,
  ],
  templateUrl: './strategy-picker-modal.component.html',
  styleUrls: ['./strategy-picker-modal.component.scss'],
})
export class StrategyPickerModalComponent implements OnInit {
  readonly attachedIds = input<readonly string[]>([]);

  private readonly library = inject(StrategyLibraryService);
  private readonly modalCtrl = inject(ModalController);

  readonly documents = signal<StrategyDocument[]>([]);
  readonly selected = signal<ReadonlySet<string>>(new Set());

  async ngOnInit(): Promise<void> {
    this.documents.set(await this.library.load());
    this.selected.set(new Set(this.attachedIds()));
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggle(id: string): void {
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
    const used = DEFAULT_STRATEGY_BRANCHES.filter((branch) => {
      const group = getAtPath(document.rules, `rules.${branch.id}`);
      return isLogicalGroup(group) && group.conditions.length > 0;
    });

    return used.length > 0 ? used.map((branch) => branch.label).join(' · ') : 'Draft — no rule yet';
  }

  confirm(): void {
    this.modalCtrl.dismiss([...this.selected()], 'confirm');
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
