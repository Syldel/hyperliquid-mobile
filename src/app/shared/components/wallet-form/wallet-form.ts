import { Component, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { add } from 'ionicons/icons';

@Component({
  selector: 'app-wallet-form',
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonIcon, IonItem, IonLabel, IonInput, IonSpinner],
  templateUrl: 'wallet-form.html',
  styleUrls: ['./wallet-form.scss'],
})
export class WalletFormComponent {
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    address: ['', [Validators.required, Validators.minLength(20)]],
  });

  loading = input<boolean>();
  error = input<string | null>();

  walletAdded = output<{ name: string; address: string }>();

  constructor() {
    addIcons({ add });
  }

  onSubmit() {
    if (this.form.invalid) return;
    this.walletAdded.emit(this.form.getRawValue());
    this.form.reset();
  }
}
