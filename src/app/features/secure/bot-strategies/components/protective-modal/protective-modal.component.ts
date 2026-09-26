import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
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
  IonNote,
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
import { ProtectiveOrderEntry, TpslType } from '@syldel/trading-shared-types';
import {
  CarriedProtectiveFields,
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
  atrMultiplier: FormControl<number | string>;
  sizePercent: FormControl<number | string>;
  carried: FormControl<CarriedProtectiveFields>;
}>;

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
  ],
  templateUrl: './protective-modal.component.html',
  styleUrls: ['./protective-modal.component.scss'],
})
export class ProtectiveModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly fb = inject(FormBuilder);

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
      atrMultiplier: [
        value.atrMultiplier,
        [Validators.required, Validators.min(0.1), Validators.max(20)],
      ],
      sizePercent: [
        value.sizePercent,
        [Validators.required, Validators.min(1), Validators.max(100)],
      ],
      // Sans champ à l'écran, et c'est le but : le formulaire le rend tel quel.
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

  atrValue(i: number): number | null {
    const v = this.entryGroup(i).get('atrMultiplier')?.value;
    return v != null && !isNaN(Number(v)) ? Number(v) : null;
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
