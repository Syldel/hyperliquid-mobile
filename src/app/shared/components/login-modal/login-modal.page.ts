import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '@auth/auth.service';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-login-modal',
  templateUrl: './login-modal.page.html',
  styleUrls: ['./login-modal.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButton,
    IonButtons,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonItem,
    IonInput,
    IonNote,
    IonFooter,
    IonSpinner,
    FormsModule,
    ReactiveFormsModule,
  ],
})
export class LoginModalPage {
  private readonly modalCtrl = inject(ModalController);
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly toastCtrl = inject(ToastController);

  loginForm: FormGroup;
  loginMethod = signal<'wallet' | 'username'>('username');
  isFormValid = signal<boolean>(false);
  isLoading = signal<boolean>(false);

  constructor() {
    this.loginForm = this.fb.group({
      walletAddress: ['', [Validators.required, Validators.pattern(/^0x[a-fA-F0-9]{40}$/)]],
      walletName: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(8)]],
    });

    this.loginForm.statusChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.isFormValid.set(this.loginFormValid());
    });
  }

  private loginFormValid(): boolean {
    const method = this.loginMethod();
    if (method === 'wallet') {
      return (
        (this.loginForm.get('walletAddress')?.valid && this.loginForm.get('password')?.valid) ||
        false
      );
    } else {
      return (
        (this.loginForm.get('walletName')?.valid && this.loginForm.get('password')?.valid) || false
      );
    }
  }

  toggleLoginMethod() {
    this.loginMethod.set(this.loginMethod() === 'wallet' ? 'username' : 'wallet');
    this.isFormValid.set(this.loginFormValid());
  }

  async onSubmit() {
    if (this.isFormValid()) {
      this.isLoading.set(true);
      try {
        const credentials = this.loginForm.value;

        if (this.loginMethod() === 'wallet') {
          await lastValueFrom(
            this.authService.loginWithWallet(credentials.walletAddress, credentials.password),
          );
        } else {
          await lastValueFrom(
            this.authService.loginWithUsername(credentials.walletName, credentials.password),
          );
        }

        this.modalCtrl.dismiss({
          method: this.loginMethod(),
          credentials:
            this.loginMethod() === 'wallet'
              ? { walletAddress: credentials.walletAddress, password: credentials.password }
              : { walletName: credentials.walletName, password: credentials.password },
        });
      } catch (err) {
        const toast = await this.toastCtrl.create({
          message: 'Login failed. Please try again.',
          duration: 3000,
          color: 'danger',
          position: 'top',
        });
        await toast.present();
      } finally {
        this.isLoading.set(false);
      }
    }
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }
}
