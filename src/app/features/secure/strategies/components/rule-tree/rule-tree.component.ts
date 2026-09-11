import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  ActionSheetController,
  IonBadge,
  IonButton,
  IonChip,
  IonIcon,
  IonLabel,
  ModalController,
} from '@ionic/angular/standalone';
import { BotService } from '@services/bot.service';
import type { RuleNode } from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import { addOutline, chevronForwardOutline, createOutline, trashOutline } from 'ionicons/icons';
import { formatRuleNode } from '../../domain/strategy-format.util';
import { hasUnsupportedNodeAt } from '../../domain/strategy-issues.util';
import {
  CREATABLE_NODE_TYPES,
  createRuleNode,
  type CreatableNodeType,
} from '../../domain/strategy-node.factory';
import { childPath } from '../../domain/strategy-path.util';
import { getAtPath, isLogicalGroup } from '../../domain/strategy-tree.ops';
import { StrategyBuilderStore } from '../../services/strategy-builder.store';
import { RuleNodeEditorModalComponent } from '../rule-node-editor-modal/rule-node-editor-modal.component';

/**
 * Rendu récursif d'un sous-arbre de règles.
 *
 * Prend un **chemin**, pas un nœud : le nœud est relu dans le store à chaque
 * rendu, donc aucune copie ne peut se désynchroniser du brouillon après une
 * édition faite ailleurs dans l'arbre.
 *
 * Au-delà de `maxInlineDepth`, un groupe n'est plus déplié : il devient une
 * puce résumée qui bascule la vue sur ce seul sous-arbre (`store.focus`). Les
 * niveaux profonds restent donc atteignables sans rendre la page illisible sur
 * un écran de téléphone.
 */
@Component({
  selector: 'app-rule-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon, IonChip, IonLabel, IonBadge],
  templateUrl: './rule-tree.component.html',
  styleUrls: ['./rule-tree.component.scss'],
})
export class RuleTreeComponent {
  readonly path = input.required<string>();
  readonly depth = input<number>(0);
  /** Profondeur de groupes dépliée en ligne avant le repli sur une puce résumée. */
  readonly maxInlineDepth = input<number>(2);

  private readonly store = inject(StrategyBuilderStore);
  private readonly bot = inject(BotService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);

  readonly node = computed(() => getAtPath(this.store.rules(), this.path()));

  readonly group = computed(() => {
    const node = this.node();
    return isLogicalGroup(node) ? node : null;
  });

  /** `true` pour un nœud hérité que ce build ne sait pas interpréter : lecture seule. */
  readonly unsupported = computed(() =>
    hasUnsupportedNodeAt(this.path(), this.store.deferredIssues()),
  );

  /**
   * `true` si le dernier verdict du bot vise cette ligne.
   *
   * Signalé sur la ligne et pas seulement dans la liste d'anomalies : un
   * message comme « Unknown indicator » ne dit rien tant qu'on ne sait pas
   * laquelle des douze conditions il désigne.
   */
  readonly faulty = computed(() => this.store.serverIssuePaths().has(this.path()));

  readonly isNegation = computed(
    () => (this.node() as { type?: unknown } | undefined)?.type === 'not',
  );

  /** Un groupe trop profond n'est plus déplié : il se résume et s'ouvre à part. */
  readonly collapsed = computed(() => !!this.group() && this.depth() >= this.maxInlineDepth());

  readonly label = computed(() =>
    formatRuleNode(this.node(), {
      maxDepth: 1,
      grammar: this.bot.ruleBuilderGrammar() ?? undefined,
    }),
  );

  /**
   * Résumé d'un groupe replié : le compte, pas l'expression.
   *
   * `maxDepth: 0` et non le `label` ci-dessus — celui-ci déplie un niveau, ce
   * qui convient à une condition terminale mais rendrait la ligne d'un groupe
   * de dix conditions illisible, précisément le cas où on l'a replié.
   */
  readonly summaryLabel = computed(() =>
    formatRuleNode(this.node(), {
      maxDepth: 0,
      grammar: this.bot.ruleBuilderGrammar() ?? undefined,
    }),
  );

  constructor() {
    addIcons({ addOutline, chevronForwardOutline, createOutline, trashOutline });
  }

  conditionPath(index: number): string {
    return childPath(childPath(this.path(), 'conditions'), index);
  }

  get negationChildPath(): string {
    return childPath(this.path(), 'condition');
  }

  focusHere(): void {
    this.store.focus(this.path());
  }

  async addCondition(): Promise<void> {
    const type = await this.pickNodeType();
    if (!type) return;

    this.store.addCondition(this.path(), createRuleNode(type));
  }

  async editNode(): Promise<void> {
    if (this.unsupported()) return;

    const modal = await this.modalCtrl.create({
      component: RuleNodeEditorModalComponent,
      componentProps: { initialNode: () => this.node() as RuleNode },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<RuleNode>();
    if (role === 'confirm' && data) this.store.replaceNode(this.path(), data);
  }

  removeNode(): void {
    this.store.removeNode(this.path());
  }

  /**
   * Types proposés = intersection de la grammaire serveur et de ce que cette
   * version sait construire.
   *
   * Le sélecteur est piloté par le serveur, mais la fabrique et le formateur
   * sont figés à la compilation : offrir un type que ce build ne sait ni créer
   * ni dessiner produirait une condition affichée « Unsupported » aussitôt
   * ajoutée. L'ordre d'affichage reste celui du serveur.
   */
  private async pickNodeType(): Promise<CreatableNodeType | null> {
    const grammar = this.bot.ruleBuilderGrammar();
    const options = (grammar?.nodeTypes ?? []).filter((option) =>
      (CREATABLE_NODE_TYPES as readonly string[]).includes(option.value),
    );
    if (options.length === 0) return null;

    const sheet = await this.actionSheetCtrl.create({
      header: 'Add condition',
      buttons: [
        ...options.map((option) => ({ text: option.label, role: option.value })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();

    const { role } = await sheet.onDidDismiss();
    if (!role || role === 'cancel' || role === 'backdrop') return null;
    return role as CreatableNodeType;
  }
}
