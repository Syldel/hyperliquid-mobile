import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
  SegmentValue,
} from '@ionic/angular/standalone';
import { roundSize } from '@utils/hl-rounding.utils';
import { computeProtectiveTriggerPx, ProtectiveOrderKind } from '@utils/protective-order.utils';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';

export interface ProtectiveOrderResult {
  id: string;
  kind: ProtectiveOrderKind;
  label: string;
  sizePercent: number;
  priceOffsetPercent: number;
  isMarket: boolean;
}

@Component({
  selector: 'app-protective-order-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonContent,
    IonFooter,
    IonButton,
    IonIcon,
    IonItem,
    IonLabel,
    IonInput,
    IonSegment,
    IonSegmentButton,
    IonList,
    IonToggle,
  ],
  templateUrl: './protective-order-form.component.html',
  styleUrls: ['./protective-order-form.component.scss'],
})
export class ProtectiveOrderFormComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  // --- Contexte de l'ordre principal (assigné via modalCtrl.create componentProps) ---
  coin = '';
  coinTitle = '';
  mainIsBuy = true;
  mainLimitPx = '';
  mainSz = '';
  szDecimals = 3;
  isSpotAsset = false;

  kind = signal<ProtectiveOrderKind>('sl');
  isMarket = signal(true);

  sizePercent = signal(100);
  sz = signal('');

  triggerPx = signal('');
  priceOffsetPercent = signal('');

  // Le side est toujours opposé à la position ouverte par l'ordre principal (ordre de clôture)
  closingIsBuy = computed(() => !this.mainIsBuy);

  mainSzNum = computed(() => parseFloat(this.mainSz) || 0);
  mainLimitPxNum = computed(() => parseFloat(this.mainLimitPx) || 0);
  maxSz = computed(() => parseFloat(roundSize(this.mainSzNum(), this.szDecimals)));

  closingSideLabel = computed(() => {
    if (this.isSpotAsset) {
      return this.closingIsBuy() ? 'Buy' : 'Sell';
    }
    return this.closingIsBuy() ? 'Long' : 'Short';
  });

  usdEquivalent = computed(() => {
    const szNum = parseFloat(this.sz());
    const price = this.mainLimitPxNum();
    if (!szNum || !price) return null;
    return szNum * price;
  });

  isTriggerValid = computed(() => {
    const priceStr = this.triggerPx();
    if (!priceStr) return false;
    const price = parseFloat(priceStr);
    const limit = this.mainLimitPxNum();
    if (isNaN(price) || !limit) return false;

    // Long: TP au-dessus du limit, SL en-dessous
    // Short: TP en-dessous du limit, SL au-dessus
    if (this.kind() === 'tp') {
      return this.mainIsBuy ? price > limit : price < limit;
    }
    return this.mainIsBuy ? price < limit : price > limit;
  });

  triggerPriceClass = computed(() =>
    this.triggerPx() && !this.isTriggerValid() ? 'diff--danger' : '',
  );

  isSizeValid = computed(() => {
    const szNum = parseFloat(this.sz());
    if (isNaN(szNum) || szNum <= 0) return false;
    return szNum <= this.maxSz() + 1e-9;
  });

  sizeClass = computed(() => (this.sz() && !this.isSizeValid() ? 'diff--danger' : ''));

  isFormInvalid = computed(() => {
    if (!this.isSizeValid()) return true;
    return !this.isTriggerValid();
  });

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit(): void {
    this.sizePercent.set(100);
    this.sz.set(roundSize(this.maxSz(), this.szDecimals));
  }

  onKindChange(value: SegmentValue | undefined): void {
    const kind = String(value);
    if (kind === 'tp' || kind === 'sl') {
      this.kind.set(kind);
    }
  }

  onSizePercentInput(value: string): void {
    this.sizePercent.set(parseFloat(value) || 0);

    const pct = parseFloat(value);
    const max = this.maxSz();
    if (!isNaN(pct) && max) {
      this.sz.set(roundSize((max * Math.min(100, Math.max(0, pct))) / 100, this.szDecimals));
    }
  }

  onSizeInput(value: string): void {
    this.sz.set(value);

    const szNum = parseFloat(value);
    const max = this.maxSz();
    if (!isNaN(szNum) && max) {
      this.sizePercent.set(Math.round((szNum / max) * 100));
    }
  }

  onTriggerPriceInput(value: string): void {
    this.triggerPx.set(value);
    const price = parseFloat(value);
    const limit = this.mainLimitPxNum();
    if (!isNaN(price) && limit) {
      const pct = (Math.abs(price - limit) / limit) * 100;
      this.priceOffsetPercent.set(pct.toFixed(2));
    }
  }

  onPriceOffsetInput(value: string): void {
    this.priceOffsetPercent.set(value);
    const pct = parseFloat(value);
    if (isNaN(pct)) return;

    const triggerPx = computeProtectiveTriggerPx(
      {
        isBuy: this.mainIsBuy,
        limitPx: this.mainLimitPx,
        szDecimals: this.szDecimals,
        isSpot: this.isSpotAsset,
      },
      { kind: this.kind(), priceOffsetPercent: pct },
    );
    this.triggerPx.set(triggerPx);
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirm(): void {
    if (this.isFormInvalid()) return;

    const result: ProtectiveOrderResult = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: this.kind(),
      label: this.kind() === 'tp' ? 'Take Profit' : 'Stop Loss',
      sizePercent: this.sizePercent(),
      priceOffsetPercent: parseFloat(this.priceOffsetPercent()) || 0,
      isMarket: this.isMarket(),
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
