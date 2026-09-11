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

/** Une expression proposée au tracé, telle que la page l'a préparée. */
export interface ExpressionRow {
  id: string;
  /** Expression telle qu'une règle l'écrit — `zscore(EMA(9), 200)`. */
  label: string;
  /** D'où elle vient : stratégie et branches. */
  detail: string;
  /** Où elle se tracera — sur les bougies ou dans son propre panneau. */
  placement: string;
  color: string;
}

/**
 * Choix des expressions à tracer sous le chart.
 *
 * Les lignes ne sont pas saisies : elles sont extraites des stratégies
 * attachées (`collectStrategyOperands`). On ne trace donc jamais qu'une
 * expression qu'une règle évalue réellement — c'est ce qui fait de ce panneau
 * un outil de débogage plutôt qu'un traceur de courbes de plus.
 */
@Component({
  selector: 'app-expression-picker-modal',
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
  templateUrl: './expression-picker-modal.component.html',
  styleUrls: ['./expression-picker-modal.component.scss'],
})
export class ExpressionPickerModalComponent implements OnInit {
  readonly rows = input<readonly ExpressionRow[]>([]);
  readonly selectedIds = input<readonly string[]>([]);

  private readonly modalCtrl = inject(ModalController);

  readonly selected = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    this.selected.set(new Set(this.selectedIds()));
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

  /** Renvoie la sélection complète, pas un delta — l'appelant remplace. */
  confirm(): void {
    this.modalCtrl.dismiss([...this.selected()], 'confirm');
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
