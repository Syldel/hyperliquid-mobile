import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonToggle,
  IonNote,
  IonBadge,
  IonProgressBar,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline,
  checkmarkOutline,
  closeOutline,
  shieldCheckmarkOutline,
  trashOutline,
  trendingDownOutline,
  trendingUpOutline,
  warningOutline,
} from 'ionicons/icons';

import { TradingPair } from '@models/user.interface';
import {
  adviseProtection,
  DistanceUnit,
  FOLLOW_MODES,
  FollowMode,
  PriceAnchor,
  ProtectionAdvice,
  ProtectiveOrderEntry,
  TpslType,
} from '@syldel/trading-shared-types';
import { BotService } from '@services/bot.service';
import { AnchorEditorModalComponent } from '../anchor-editor-modal/anchor-editor-modal.component';
import { formatOperand } from '../../../strategies/domain/strategy-format.util';
import {
  CarriedProtectiveFields,
  toProtectiveEntry,
  toProtectiveEntryForm,
  toProtectiveStrategy,
} from '../../domain/protective-entry-form.util';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ProtectiveModalResult {
  pair: TradingPair;
}

// ─── Validator ───────────────────────────────────────────────────────────────

/**
 * Vérifie que la somme des sizePercent pour un type donné (tp|sl) ≤ 100.
 * Appliqué sur le FormArray global.
 */
function sizePercentSumValidator(type: TpslType): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!(control instanceof FormArray)) return null;
    const sum = (control.controls as FormGroup[])
      .filter((g) => g.get('tpsl')?.value === type)
      .reduce((acc, g) => acc + (Number(g.get('sizePercent')?.value) || 0), 0);
    return sum > 100 ? { [`${type}SumExceeds100`]: { sum: Math.round(sum * 10) / 10 } } : null;
  };
}

// ─── Form model ──────────────────────────────────────────────────────────────

/**
 * Une ligne du formulaire. `carried` n'a pas de champ à l'écran : il transporte
 * ce que la modale ne sait pas encore éditer — ancre, mode de suivi, plancher,
 * condition — pour que sauver ne l'efface pas. Voir
 * `domain/protective-entry-form.util.ts`.
 *
 * Le typage n'est pas cosmétique : c'est lui qui permet à `getRawValue()` de
 * rendre exactement `ProtectiveEntryFormValue[]`, donc de supprimer le
 * `as ProtectiveOrderEntry[]` qui affirmait au compilateur ce que l'objet
 * n'avait pas.
 */
type ProtectiveEntryGroup = FormGroup<{
  tpsl: FormControl<TpslType>;
  distanceUnit: FormControl<DistanceUnit>;
  distanceValue: FormControl<number | string>;
  sizePercent: FormControl<number | string>;
  anchor: FormControl<PriceAnchor>;
  followMode: FormControl<FollowMode>;
  boundedByEntry: FormControl<boolean>;
  carried: FormControl<CarriedProtectiveFields>;
}>;

/**
 * Libellés courts des modes de suivi. Écrits ici, et non servis, parce qu'ils
 * n'expliquent rien : l'explication qui compte est celle d'`adviseProtection`,
 * qui juge la **combinaison** entière et vit dans les types partagés.
 */
const FOLLOW_MODE_LABELS: Record<FollowMode, string> = {
  FIXED: 'Fixed — computed once, at entry',
  TIGHTEN_ONLY: 'Tighten only — may move toward the price',
  WIDEN_ONLY: 'Widen only — may move away from the price',
  FREE: 'Free — follows its anchor both ways',
};

/** Le niveau d'avis, traduit en couleur Ionic. */
const ADVICE_COLORS: Record<ProtectionAdvice['level'], string> = {
  standard: 'success',
  legitimate: 'primary',
  caution: 'warning',
  runaway: 'danger',
};

/**
 * Le plafond de la distance dépend de son unité : 20 ATR est un écart énorme,
 * 20 % ne l'est pas. Le plancher, lui, ne bouge pas — une distance nulle est
 * refusée par la validation partagée (`INVALID_DISTANCE_VALUE`).
 *
 * ⚠️ Lu à la construction du contrôle, donc figé tant que l'unité n'est pas
 * modifiable à l'écran. Il devra suivre le sélecteur d'unité.
 */
const MAX_DISTANCE_BY_UNIT: Record<DistanceUnit, number> = {
  ATR: 20,
  PERCENT: 100,
};

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-protective-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonIcon,
    IonNote,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonChip,
    IonProgressBar,
    IonBadge,
    IonLabel,
    IonToggle,
  ],
  templateUrl: './protective-modal.component.html',
  styleUrls: ['./protective-modal.component.scss'],
})
export class ProtectiveModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly fb = inject(FormBuilder);
  private readonly bot = inject(BotService);
  private readonly cdr = inject(ChangeDetectorRef);

  // ── Input ─────────────────────────────────────────────────────────────────

  readonly pair = input.required<TradingPair>();

  // ── Signals ───────────────────────────────────────────────────────────────

  readonly tpSum = signal(0);
  readonly slSum = signal(0);

  readonly tpProgress = computed(() => Math.min(this.tpSum() / 100, 1));
  readonly slProgress = computed(() => Math.min(this.slSum() / 100, 1));
  readonly tpOver = computed(() => this.tpSum() > 100);
  readonly slOver = computed(() => this.slSum() > 100);
  readonly tpRemaining = computed(() => Math.max(0, 100 - this.tpSum()));
  readonly slRemaining = computed(() => Math.max(0, 100 - this.slSum()));

  // ── Form ──────────────────────────────────────────────────────────────────

  form!: FormGroup<{ entries: FormArray<ProtectiveEntryGroup> }>;

  constructor() {
    addIcons({
      addOutline,
      trashOutline,
      warningOutline,
      trendingUpOutline,
      trendingDownOutline,
      closeOutline,
      shieldCheckmarkOutline,
      checkmarkOutline,
    });
  }

  ngOnInit(): void {
    const existing = this.pair().strategy?.protective;

    this.form = this.fb.group({
      entries: this.fb.array(
        (existing?.entries ?? []).map((e) => this.buildEntryGroup(e)),
        [sizePercentSumValidator('tp'), sizePercentSumValidator('sl')],
      ),
    });

    this.refreshSums();
  }

  // ── FormArray helpers ─────────────────────────────────────────────────────

  get entries(): FormArray<ProtectiveEntryGroup> {
    return this.form.controls.entries;
  }

  entryGroup(i: number): ProtectiveEntryGroup {
    return this.entries.at(i);
  }

  private buildEntryGroup(entry?: Partial<ProtectiveOrderEntry>): ProtectiveEntryGroup {
    const value = toProtectiveEntryForm(entry);

    return this.fb.nonNullable.group({
      tpsl: [value.tpsl, Validators.required],
      distanceUnit: [value.distanceUnit, Validators.required],
      distanceValue: [
        value.distanceValue,
        [
          Validators.required,
          Validators.min(0.1),
          Validators.max(MAX_DISTANCE_BY_UNIT[value.distanceUnit]),
        ],
      ],
      sizePercent: [
        value.sizePercent,
        [Validators.required, Validators.min(1), Validators.max(100)],
      ],
      anchor: [value.anchor],
      followMode: [value.followMode, Validators.required],
      boundedByEntry: [value.boundedByEntry],
      // Ce qui reste sans champ à l'écran — condition, drapeaux, champs d'un
      // build plus récent : le formulaire le rend tel quel.
      carried: [value.carried],
    });
  }

  addEntry(type: TpslType): void {
    const remaining = type === 'tp' ? this.tpRemaining() : this.slRemaining();
    this.entries.push(
      this.buildEntryGroup({ tpsl: type, sizePercent: remaining > 0 ? remaining : 50 }),
    );
    this.onEntriesChanged();
  }

  removeEntry(i: number): void {
    this.entries.removeAt(i);
    this.onEntriesChanged();
  }

  onEntriesChanged(): void {
    this.entries.updateValueAndValidity();
    this.refreshSums();
  }

  // ── Sums ──────────────────────────────────────────────────────────────────

  private refreshSums(): void {
    const rows = this.entries.getRawValue();
    const sum = (type: TpslType) =>
      rows
        .filter((row) => row.tpsl === type)
        .reduce((s, row) => s + (Number(row.sizePercent) || 0), 0);
    this.tpSum.set(sum('tp'));
    this.slSum.set(sum('sl'));
  }

  // ── Template helpers ──────────────────────────────────────────────────────

  isTp(i: number): boolean {
    return this.entryGroup(i).get('tpsl')?.value === 'tp';
  }

  distanceValue(i: number): number | null {
    const v = this.entryGroup(i).controls.distanceValue.value;
    return v != null && !isNaN(Number(v)) ? Number(v) : null;
  }

  readonly followModes = FOLLOW_MODES;
  readonly distanceUnits = this.bot.distanceUnits();

  /** Ce que l'ancre désigne, en une ligne lisible. */
  anchorLabel(i: number): string {
    const anchor = this.entryGroup(i).controls.anchor.value;

    switch (anchor.source) {
      case 'ENTRY':
        return 'Entry price';
      case 'MARKET':
        return 'Market price';
      case 'EXPRESSION':
        return formatOperand(anchor.expression);
    }
  }

  async openAnchorEditor(i: number): Promise<void> {
    const control = this.entryGroup(i).controls.anchor;

    const modal = await this.modalCtrl.create({
      component: AnchorEditorModalComponent,
      componentProps: {
        initialAnchor: () => control.value,
        context: () => 'protective' as const,
      },
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss<PriceAnchor>();
    if (role !== 'confirm' || !data) return;

    control.setValue(data);
    this.onEntriesChanged();

    // ⚠️ `markForCheck` est indispensable, et pas une précaution : cette app est
    // **zoneless** (Angular 21, `zone.js` n'est même pas une dépendance). Rien
    // ne repeint tout seul — seuls un signal ou une notification explicite le
    // font. Les autres champs s'en sortent par leurs liaisons d'évènement
    // (`ionInput`, `ionChange`) ; ce chemin-ci revient d'une modale et n'en a
    // aucune. Les sommes écrivent bien des signaux, mais changer d'ancre ne les
    // change pas : l'ancienne ancre restait donc affichée jusqu'à la prochaine
    // interaction.
    this.cdr.markForCheck();
  }

  /**
   * Ce que cette configuration fait réellement, jugé par les types partagés.
   *
   * Le verdict n'est pas recalculé ici : `adviseProtection` est la même
   * fonction que celle dont le bot journalise la sortie. Deux jugements écrits
   * séparément dériveraient.
   */
  advice(i: number): ProtectionAdvice | null {
    return adviseProtection(toProtectiveEntry(this.entryGroup(i).getRawValue()));
  }

  adviceColor(i: number): string {
    const advice = this.advice(i);
    return advice ? ADVICE_COLORS[advice.level] : 'medium';
  }

  followModeLabel(mode: FollowMode): string {
    return FOLLOW_MODE_LABELS[mode];
  }

  /** La phrase du bot sur l'unité choisie, jamais une reformulation locale. */
  distanceUnitDescription(i: number): string | null {
    const unit = this.entryGroup(i).controls.distanceUnit.value;
    return this.distanceUnits.find((u) => u.value === unit)?.description ?? null;
  }

  /**
   * De quel côté de son ancre la protection se pose.
   *
   * Lu comme le bot le lit : c'est le couple (côté, sens du trade) qui décide,
   * et la modale ne connaissant pas le sens de la position, elle montre le cas
   * d'un long — le seul que l'ancien aperçu montrait déjà.
   */
  isAbove(i: number): boolean {
    return this.isTp(i);
  }

  /** Ce que la distance multiplie, tel qu'il s'affiche à côté du nombre. */
  distanceUnitLabel(i: number): string {
    return this.entryGroup(i).controls.distanceUnit.value === 'PERCENT' ? '%' : '× ATR';
  }

  hasExistingStrategy(): boolean {
    return !!this.pair().strategy?.protective;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  save(): void {
    if (this.form.invalid) return;

    const currentStrategy = this.pair().strategy;
    if (!currentStrategy) return;

    const updatedPair: TradingPair = {
      ...this.pair(),
      strategy: {
        ...currentStrategy,
        // `currentStrategy.protective` est passé pour lui-même : `enabled` est
        // un réglage du bloc, que la modale n'affiche pas et ne doit pas
        // éteindre ni rallumer en passant.
        protective: toProtectiveStrategy(this.entries.getRawValue(), currentStrategy.protective),
      },
    };

    this.modalCtrl.dismiss({ pair: updatedPair } satisfies ProtectiveModalResult, 'confirm');
  }

  clearStrategy(): void {
    const currentStrategy = this.pair().strategy;
    if (!currentStrategy) return;

    const { protective: _removed, ...strategyWithout } = currentStrategy;
    const updatedPair: TradingPair = {
      ...this.pair(),
      strategy: strategyWithout,
    };
    this.modalCtrl.dismiss({ pair: updatedPair } satisfies ProtectiveModalResult, 'confirm');
  }
}
