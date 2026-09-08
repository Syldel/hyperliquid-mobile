import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type { Operand, RuleNode } from '@syldel/trading-shared-types';
import { formatOperand } from '../../domain/strategy-format.util';
import { OperandEditorModalComponent } from '../operand-editor-modal/operand-editor-modal.component';

/** Emplacement d'opérande éditable sur un nœud, selon son type. */
type OperandSlot = 'left' | 'right' | 'target';

/**
 * Édition des champs propres à UN nœud : opérateur, direction, période, et les
 * opérandes qu'il porte directement.
 *
 * Ne descend jamais dans les sous-conditions — un `logical` ou un `not` se
 * modifie dans l'arbre, pas ici. Cette modale ne traite que ce qui est atomique
 * au nœud lui-même.
 *
 * Tous les libellés d'énumération viennent de `ruleBuilderGrammar`
 * (`/exchanges/meta`) : cette version ne maintient aucune liste d'options.
 */
@Component({
  selector: 'app-rule-node-editor-modal',
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
    IonInput,
    IonSelect,
    IonSelectOption,
  ],
  templateUrl: './rule-node-editor-modal.component.html',
  styleUrls: ['./rule-node-editor-modal.component.scss'],
})
export class RuleNodeEditorModalComponent implements OnInit {
  readonly initialNode = input<RuleNode | null>(null);

  private readonly bot = inject(BotService);
  private readonly modalCtrl = inject(ModalController);

  readonly node = signal<RuleNode | null>(null);

  readonly grammar = this.bot.ruleBuilderGrammar;

  /** Modes de tendance, précédés d'une option « défaut » : `mode` absent vaut STRICT. */
  readonly trendModes = computed(() => [
    { value: '', label: 'Default (strict)' },
    ...(this.grammar()?.trendModes ?? []),
  ]);

  ngOnInit(): void {
    this.node.set(this.initialNode());
  }

  /** Libellé d'un emplacement d'opérande, tel qu'affiché sur sa ligne. */
  operandLabel(slot: OperandSlot): string {
    const node = this.node() as Record<string, unknown> | null;
    return node ? formatOperand(node[slot]) : '';
  }

  patch(changes: Record<string, unknown>): void {
    const node = this.node();
    if (!node) return;
    this.node.set({ ...node, ...changes } as RuleNode);
  }

  /** Une valeur vide signifie « mode non renseigné », pas « STRICT explicite ». */
  onTrendModeChange(value: string): void {
    const node = this.node();
    if (!node) return;

    const { mode: _dropped, ...rest } = node as unknown as Record<string, unknown>;
    this.node.set((value ? { ...rest, mode: value } : rest) as unknown as RuleNode);
  }

  async editOperand(slot: OperandSlot, label: string): Promise<void> {
    const node = this.node() as Record<string, unknown> | null;
    if (!node) return;

    const modal = await this.modalCtrl.create({
      component: OperandEditorModalComponent,
      componentProps: {
        initialOperand: () => node[slot] as Operand,
        slotLabel: () => label,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<Operand>();
    if (role === 'confirm' && data) this.patch({ [slot]: data });
  }

  confirm(): void {
    this.modalCtrl.dismiss(this.node(), 'confirm');
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
