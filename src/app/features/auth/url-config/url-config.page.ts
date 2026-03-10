import { Component, input, OnInit, output } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ModalController } from '@ionic/angular';
import {
  IonButton,
  IonContent,
  IonFooter,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AppConfig } from '@models/app-config.interface';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';

type FormConfig = {
  [K in keyof AppConfig]: FormControl<AppConfig[K]>;
};

@Component({
  selector: 'app-url-config',
  templateUrl: './url-config.page.html',
  styleUrls: ['./url-config.page.scss'],
  standalone: true,
  imports: [
    IonItem,
    IonToolbar,
    IonButton,
    IonContent,
    IonLabel,
    IonInput,
    IonList,
    IonNote,
    IonFooter,
    ReactiveFormsModule,
    PageHeaderComponent,
  ],
  providers: [ModalController],
})
export class UrlConfigPage implements OnInit {
  initialConfig = input<AppConfig>({
    userServiceUrl: '',
    hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
    hyperliquidGatewayUrl: '',
  });

  configSaved = output<AppConfig>();

  configForm: FormGroup<FormConfig>;

  constructor(
    private readonly fb: FormBuilder,
    private readonly modalCtrl: ModalController,
  ) {
    this.configForm = this.fb.nonNullable.group<FormConfig>({
      userServiceUrl: this.fb.nonNullable.control('', [
        Validators.required,
        Validators.pattern(/^https?:\/\/.+/),
      ]),
      hyperliquidPublicUrl: this.fb.nonNullable.control('', [
        Validators.required,
        Validators.pattern(/^https?:\/\/.+/),
      ]),
      hyperliquidGatewayUrl: this.fb.nonNullable.control('', [
        Validators.required,
        Validators.pattern(/^https?:\/\/.+/),
      ]),
    });
  }

  ngOnInit() {
    this.configForm.reset(this.initialConfig());
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }

  saveConfig() {
    if (this.configForm.valid) {
      const config = this.configForm.getRawValue();
      this.configSaved.emit(config);
      this.modalCtrl.dismiss(config);
    }
  }
}
