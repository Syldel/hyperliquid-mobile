import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
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
import type { AnchorSource, Operand, PriceAnchor } from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import { closeOutline, createOutline } from 'ionicons/icons';
import { formatOperand } from '../../../strategies/domain/strategy-format.util';
import { OperandEditorModalComponent } from '../../../strategies/components/operand-editor-modal/operand-editor-modal.component';

/**
 * ============================================================================
 * 📍 OÙ SE POSE UN ORDRE
 *
 * Une ancre est l'origine du prix, jamais l'écart : `ENTRY` et `MARKET` ne
 * portent rien, `EXPRESSION` porte un `Operand` complet du rule-builder.
 *
 * L'expression n'est **pas** rééditée ici : elle est déléguée à
 * `OperandEditorModalComponent`, qui sait déjà construire indicateurs,
 * arithmétique, `min`/`max` et transformations, récursivement et jusqu'à la
 * profondeur que le serveur accepte. En écrire un second, bridé, aurait
 * dupliqué la seule chose qu'il ne faut jamais dupliquer : la façon de
 * construire un opérande.
 *
 * Les sources viennent de `/exchanges/meta`, filtrées par le contexte —
 * `ENTRY` n'a aucun sens pour un ordre **latent**, qui n'a pas encore de
 * position dont parler, et c'est le bot qui le dit.
 * ============================================================================
 */
@Component({
  selector: 'app-anchor-editor-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    IonNote,
    IonSelect,
    IonSelectOption,
  ],
  templateUrl: './anchor-editor-modal.component.html',
  styleUrls: ['./anchor-editor-modal.component.scss'],
})
export class AnchorEditorModalComponent implements OnInit {
  readonly initialAnchor = input<PriceAnchor | null>(null);
  /** Ce que le bot nomme `allowedContexts` : toutes les sources n'y ont pas cours. */
  readonly context = input<'latent' | 'protective'>('protective');

  private readonly bot = inject(BotService);
  private readonly modalCtrl = inject(ModalController);

  readonly source = signal<AnchorSource>('ENTRY');
  readonly expression = signal<Operand | null>(null);

  readonly sources = computed(() =>
    this.bot.anchorSources().filter((s) => s.allowedContexts.includes(this.context())),
  );

  readonly expressionLabel = computed(() => {
    const operand = this.expression();
    return operand ? formatOperand(operand) : null;
  });

  constructor() {
    addIcons({ closeOutline, createOutline });
  }

  ngOnInit(): void {
    const anchor = this.initialAnchor();
    if (!anchor) return;

    this.source.set(anchor.source);
    if (anchor.source === 'EXPRESSION') this.expression.set(anchor.expression);
  }

  /** Une expression est obligatoire dès que la source en réclame une. */
  readonly canConfirm = computed(
    () => this.source() !== 'EXPRESSION' || this.expression() !== null,
  );

  async editExpression(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: OperandEditorModalComponent,
      componentProps: {
        initialOperand: () => this.expression(),
        slotLabel: () => 'Anchor',
        depth: () => 0,
      },
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss<Operand>();
    if (role === 'confirm' && data) this.expression.set(data);
  }

  confirm(): void {
    const source = this.source();

    // Rien n'est deviné : une source qui réclame une expression ne peut pas
    // être confirmée sans elle (`canConfirm`), et les deux autres n'en portent
    // aucune — y laisser traîner l'ancienne écrirait un champ que le bot
    // ignorerait sans le dire.
    const anchor: PriceAnchor =
      source === 'EXPRESSION' ? { source, expression: this.expression()! } : { source };

    this.modalCtrl.dismiss(anchor, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
