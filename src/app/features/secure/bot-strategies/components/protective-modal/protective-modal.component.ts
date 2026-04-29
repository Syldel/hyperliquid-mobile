import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
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

import {
  ProtectiveOrderEntry,
  ProtectiveOrderStrategy,
  TpslType,
  TradingPair,
} from '@models/user.interface';

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

  form!: FormGroup;

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
    const existing = this.pair().strategy.protective;

    this.form = this.fb.group({
      entries: this.fb.array(
        (existing?.entries ?? []).map((e) => this.buildEntryGroup(e)),
        [sizePercentSumValidator('tp'), sizePercentSumValidator('sl')],
      ),
    });

    this.refreshSums();
  }

  // ── FormArray helpers ─────────────────────────────────────────────────────

  get entries(): FormArray {
    return this.form.get('entries') as FormArray;
  }

  entryGroup(i: number): FormGroup {
    return this.entries.at(i) as FormGroup;
  }

  private buildEntryGroup(entry?: Partial<ProtectiveOrderEntry>): FormGroup {
    return this.fb.group({
      tpsl: [entry?.tpsl ?? 'tp', Validators.required],
      atrMultiplier: [
        entry?.atrMultiplier ?? 1.5,
        [Validators.required, Validators.min(0.1), Validators.max(20)],
      ],
      sizePercent: [
        entry?.sizePercent ?? 100,
        [Validators.required, Validators.min(1), Validators.max(100)],
      ],
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
    const sum = (type: TpslType) =>
      (this.entries.controls as FormGroup[])
        .filter((g) => g.get('tpsl')?.value === type)
        .reduce((s, g) => s + (Number(g.get('sizePercent')?.value) || 0), 0);
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
    return !!this.pair().strategy.protective;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  save(): void {
    if (this.form.invalid) return;

    const strategy: ProtectiveOrderStrategy = {
      entries: this.form.value.entries as ProtectiveOrderEntry[],
    };

    const updatedPair: TradingPair = {
      ...this.pair(),
      strategy: { ...this.pair().strategy, protective: strategy },
    };

    this.modalCtrl.dismiss({ pair: updatedPair } satisfies ProtectiveModalResult, 'confirm');
  }

  clearStrategy(): void {
    const { protective: _removed, ...strategyWithout } = this.pair().strategy;
    const updatedPair: TradingPair = {
      ...this.pair(),
      strategy: strategyWithout,
    };
    this.modalCtrl.dismiss({ pair: updatedPair } satisfies ProtectiveModalResult, 'confirm');
  }
}
