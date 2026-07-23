import { ChangeDetectionStrategy, Component, computed, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { CANDLE_INTERVALS, CandleInterval } from '@syldel/hl-shared-types';
import { addIcons } from 'ionicons';
import { chevronForwardOutline } from 'ionicons/icons';
import { INTERVAL_LABELS, WatchlistItem } from '../../models/watchlist-item.model';

/** Open this modal to add a pair to the watchlist. */
@Component({
  selector: 'app-add-watchlist-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonText,
    IonIcon,
    IonSelect,
    IonSelectOption,
  ],
  templateUrl: './add-watchlist-modal.component.html',
  styleUrls: ['./add-watchlist-modal.component.scss'],
})
export class AddWatchlistModalComponent implements OnInit {
  form!: FormGroup;

  readonly intervals = CANDLE_INTERVALS;
  readonly intervalLabels = INTERVAL_LABELS;

  selectedCoin = signal<string>('');

  // Mode édition — passé via componentProps
  initialItem = signal<WatchlistItem | null>(null);

  readonly isEditMode = computed(() => !!this.initialItem());
  readonly headerTitle = computed(() => (this.isEditMode() ? 'Edit pair' : 'Add to watchlist'));
  readonly submitButtonLabel = computed(() => (this.isEditMode() ? 'Save' : 'Add'));

  constructor(
    private fb: FormBuilder,
    private modalCtrl: ModalController,
  ) {
    addIcons({ chevronForwardOutline });
  }

  ngOnInit(): void {
    const item = this.initialItem();
    this.form = this.fb.group({
      coin: [{ value: item?.coin ?? '', disabled: this.isEditMode() }, Validators.required],
      interval: [item?.interval ?? ('1h' as CandleInterval), Validators.required],
    });
    if (item) this.selectedCoin.set(item.coin);
  }

  async openMarketPicker(): Promise<void> {
    if (this.isEditMode()) return;

    const { MarketPickerModalComponent } = await import(
      '@shared/components/market-picker-modal/market-picker-modal.component' as any
    );

    const modal = await this.modalCtrl.create({
      component: MarketPickerModalComponent,
      componentProps: {
        initialValue: () => this.form.value.coin,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<string>();
    if (role === 'confirm' && data) {
      this.form.patchValue({ coin: data });
      this.selectedCoin.set(data);
    }
  }

  confirm(): void {
    if (this.form.invalid) return;
    const coin = this.isEditMode() ? this.initialItem()!.coin : this.form.value.coin;
    this.modalCtrl.dismiss({ coin, interval: this.form.value.interval }, 'confirm');
  }

  cancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
