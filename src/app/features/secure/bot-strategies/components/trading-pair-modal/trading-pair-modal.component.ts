import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
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
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRange,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { TradingPair } from '@models/user.interface';
import { AvailableCapitalService } from '@services/available-capital.service';
import { BotService } from '@services/bot.service';
import { MarketPickerModalComponent } from '@shared/components/market-picker-modal/market-picker-modal.component';
import {
  ChartInterval,
  ExitBehavior,
  ExitBehaviorMeta,
  IExchange,
  IExchangeStrategy,
  PublicStrategyValidationIssue,
  StrategyMeta,
  StrategyParameter,
  StrategySettings,
} from '@syldel/trading-shared-types';
import { addIcons } from 'ionicons';
import {
  addOutline,
  checkmarkOutline,
  chevronForwardOutline,
  closeCircle,
  closeOutline,
  removeOutline,
} from 'ionicons/icons';
import { combineLatest, debounceTime, firstValueFrom } from 'rxjs';
import { StrategyBuilderModalComponent } from '../../../strategies/components/strategy-builder-modal/strategy-builder-modal.component';
import { StrategyPickerModalComponent } from '../../../strategies/components/strategy-picker-modal/strategy-picker-modal.component';
import { isLocallyExecutable } from '../../../strategies/domain/strategy-issues.util';
import { branchSummary } from '../../../strategies/domain/strategy-summary.util';
import { pruneEmptyRuleBranches } from '../../../strategies/domain/strategy-tree.ops';
import {
  ruleBranchesOf,
  toStrategyDocument,
  type StrategyDocument,
} from '../../../strategies/models/strategy-document.model';
import {
  generateStrategyId,
  StrategyLibraryService,
} from '../../../strategies/services/strategy-library.service';

interface TradingPairForm {
  exchangeKey: FormControl<string>;
  pairName: FormControl<string>;
  strategy: FormControl<StrategyMeta>;
  exitBehavior: FormControl<ExitBehavior>;
  ratio: FormControl<number>;
  interval: FormControl<ChartInterval>;
  enabled: FormControl<boolean>;
}

export interface TradingPairModalResult {
  exchangeKey: string;
  pair: TradingPair;
}

@Component({
  selector: 'app-trading-pair-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TitleCasePipe,
    CurrencyPipe,
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
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonRange,
    IonToggle,
    IonNote,
    IonText,
    IonInput,
  ],
  templateUrl: './trading-pair-modal.component.html',
  styleUrls: ['./trading-pair-modal.component.scss'],
})
export class TradingPairModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly botService = inject(BotService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly availableCapitalService = inject(AvailableCapitalService);
  private readonly library = inject(StrategyLibraryService);
  private readonly toastCtrl = inject(ToastController);

  // ------------------------------------------------------------------
  //  Inputs
  // ------------------------------------------------------------------

  readonly exchanges = input<{ key: string; value: IExchange }[]>([]);
  readonly editPair = input<TradingPair | undefined>();
  readonly editExchangeKey = input<string | undefined>();

  // ------------------------------------------------------------------
  //  State
  // ------------------------------------------------------------------

  isLoadingMetadata = signal(false);
  candleIntervals = signal<ChartInterval[]>([]);
  strategies = signal<StrategyMeta[]>([]);
  availableExchanges = signal<string[]>([]);
  strategiesByExchange = signal<Record<string, StrategyMeta[]>>({});
  metadataError = signal(false);
  exitBehaviors = signal<ExitBehaviorMeta[]>([]);

  /** FormGroup reconstruit dynamiquement à chaque changement de strategy */
  strategyParamsForm = signal<FormGroup>(this.fb.group({}));

  /** Paramètres scalaires de la strategy actuellement sélectionnée (hors `rule-builder`). */
  readonly currentStrategyParams = signal<StrategyParameter[]>([]);

  /**
   * Règles de la paire, sous la forme d'un document de bibliothèque.
   *
   * La paire en conserve un **instantané** : ce qui est enregistré côté compte
   * utilisateur est `IExchangeStrategy.rules`, pas une référence au document.
   * Éditer ensuite la stratégie dans la bibliothèque ne change donc pas ce que
   * le bot exécute tant que la paire n'a pas été rouverte et réenregistrée.
   */
  readonly ruleDocument = signal<StrategyDocument | null>(null);

  /** Anomalies renvoyées par le bot au dernier enregistrement — il fait autorité. */
  readonly serverIssues = signal<PublicStrategyValidationIssue[]>([]);
  readonly validating = signal(false);

  // ------------------------------------------------------------------
  //  Computed
  // ------------------------------------------------------------------

  readonly filteredStrategies = computed(() => {
    const exchangeKey = this.formValue().exchangeKey;
    if (!exchangeKey) return this.strategies();
    return this.strategiesByExchange()[exchangeKey] ?? this.strategies();
  });

  readonly selectableExchanges = computed(() => {
    const fromApi = this.availableExchanges();
    const fromInput = this.exchanges().map((e) => e.key);
    return [...new Set([...fromApi, ...fromInput])];
  });

  readonly selectedExitBehaviorDescription = computed(() => {
    const value = this.formValue().exitBehavior;
    return this.exitBehaviors().find((eb) => eb.value === value)?.description ?? '';
  });

  readonly isEditMode = computed(() => !!this.editPair());

  /**
   * Branches de règles déclarées par la stratégie choisie, telles que servies
   * par `/exchanges/meta`. Vide pour une stratégie codée en dur — c'est aussi
   * ce qui décide de l'affichage de la section « rules », plutôt qu'un test sur
   * le `shortname` : le catalogue reste seul juge de ce qu'une stratégie expose.
   */
  readonly ruleBranches = computed(() => ruleBranchesOf(this.formValue().strategy?.parameters));

  readonly usesRules = computed(() => this.ruleBranches().length > 0);

  readonly rulesSummary = computed(() =>
    branchSummary(this.ruleDocument()?.rules, this.ruleBranches(), 'No rule yet'),
  );

  /**
   * `true` si les règles peuvent être confiées au bot : au moins un côté à
   * évaluer, et aucune anomalie dont ce build soit certain. Le verdict serveur
   * reste demandé par-dessus à l'enregistrement — voir `submit`.
   */
  readonly rulesReady = computed(() => {
    const document = this.ruleDocument();
    if (!document) return false;

    const rules = pruneEmptyRuleBranches(document.rules);
    return (!!rules.long || !!rules.short) && isLocallyExecutable(rules);
  });

  // ------------------------------------------------------------------
  //  Form
  // ------------------------------------------------------------------

  private pairNameExistsValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const exchangeKey = this.form?.getRawValue().exchangeKey;
      const exchange = this.exchanges?.()?.find((e) => e.key === exchangeKey);
      if (!exchange) return null;

      const existingNames = exchange.value.pairs.map((p) => p.name);
      const currentName = this.editPair?.()?.name;
      const conflict = existingNames.filter((n) => n !== currentName).includes(control.value);

      return conflict ? { pairNameExists: true } : null;
    };
  }

  readonly form = this.fb.nonNullable.group<TradingPairForm>({
    exchangeKey: this.fb.nonNullable.control('', Validators.required),
    pairName: this.fb.nonNullable.control('', [
      Validators.required,
      this.pairNameExistsValidator(),
    ]),
    strategy: this.fb.nonNullable.control<StrategyMeta>(null as any, Validators.required),
    exitBehavior: this.fb.nonNullable.control<ExitBehavior>('STRATEGY_SIGNAL', Validators.required),
    ratio: this.fb.nonNullable.control(0, [
      Validators.required,
      Validators.min(0),
      Validators.max(100),
    ]),
    interval: this.fb.nonNullable.control<ChartInterval>(null as any, Validators.required),
    enabled: this.fb.nonNullable.control(true),
  });

  readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly formStatus = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });

  /**
   * Valide si le form principal, les paramètres dynamiques et — pour une
   * stratégie pilotée par règles — l'arbre lui-même sont exploitables.
   *
   * Sans ce dernier point, choisir « Advanced Logical Rules » sans jamais
   * ouvrir le builder enregistrerait une paire que le bot chargerait pour
   * n'en rien faire.
   */
  readonly isValid = computed(
    () =>
      this.formStatus() === 'VALID' &&
      this.strategyParamsForm().valid &&
      (!this.usesRules() || this.rulesReady()),
  );

  // ------------------------------------------------------------------
  //  Metadata loading
  // ------------------------------------------------------------------

  private loadMetadata(): void {
    this.isLoadingMetadata.set(true);
    this.metadataError.set(false);
    this.form.controls.strategy.disable();
    this.form.controls.interval.disable();

    this.botService.getExchangeFormMetadata().subscribe({
      next: (meta) => {
        this.candleIntervals.set(meta.intervals);
        this.availableExchanges.set(meta.exchanges);
        this.strategiesByExchange.set(meta.strategies);
        this.exitBehaviors.set(meta.globalOptions?.exitBehaviors ?? []);

        const all = Object.values(meta.strategies).flat();
        this.strategies.set(all);

        this.form.controls.strategy.enable();
        this.form.controls.interval.enable();
        this.resolveEditedStrategy(all);
      },
      error: () => {
        this.metadataError.set(true);
        this.isLoadingMetadata.set(false);
      },
      complete: () => this.isLoadingMetadata.set(false),
    });
  }

  /**
   * Rebranche la paire éditée sur l'entrée de catalogue correspondante.
   *
   * Une paire enregistrée porte une `IExchangeStrategy` — du métier, sans
   * `parameters`. Le sélecteur, lui, a besoin de la `StrategyMeta` : c'est
   * elle qui déclare les champs à afficher, y compris les branches de règles.
   * Les faire coïncider ici est ce qui permet de rouvrir en édition une
   * stratégie « advanced-rules » sans que le formulaire ait à deviner son
   * schéma depuis les données.
   *
   * Une stratégie absente du catalogue (renommée, retirée) laisse le contrôle
   * vide plutôt que d'inventer une entrée : le formulaire reste invalide et
   * l'utilisateur doit en choisir une, ce qui vaut mieux qu'enregistrer un
   * `shortname` que le bot n'exécute pas.
   */
  private resolveEditedStrategy(catalogue: StrategyMeta[]): void {
    const shortname = this.editPair()?.strategy?.shortname;
    if (!shortname) return;

    const meta = catalogue.find((candidate) => candidate.shortname === shortname);
    if (meta) this.form.patchValue({ strategy: meta });
  }

  availableCapital = signal<number | null>(null);
  isLoadingCapital = signal(false);

  private extractDex(pairName: string): string {
    const parts = pairName.split(':');
    return parts.length > 1 ? parts[0] : '';
  }

  private loadCapital(exchangeKey: string, pairName: string): void {
    if (!pairName) {
      this.availableCapital.set(null);
      return;
    }

    if (exchangeKey === 'hyperliquid') {
      const dex = this.extractDex(pairName);

      this.isLoadingCapital.set(true);
      this.availableCapitalService
        .getAvailableCapital(dex, pairName)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (capital) => this.availableCapital.set(capital),
          error: () => {
            this.availableCapital.set(null);
            this.isLoadingCapital.set(false);
          },
          complete: () => this.isLoadingCapital.set(false),
        });
    } else {
      this.availableCapital.set(null);
    }
  }

  readonly ratioInUsd = computed(() => {
    const capital = this.availableCapital();
    const ratio = this.formValue().ratio;
    if (capital === null || !ratio) return null;
    return (capital * ratio) / 100;
  });

  // ------------------------------------------------------------------
  //  Dynamic params form builder
  // ------------------------------------------------------------------

  /**
   * Reconstruit le FormGroup des paramètres dynamiques à chaque fois que la
   * strategy change.
   *
   * Les paramètres `rule-builder` en sont exclus : ils n'alimentent pas
   * `settings` mais `rules`, et se saisissent dans le builder, pas dans un
   * contrôle de formulaire. Les y laisser produisait des contrôles `null`
   * enregistrés tels quels sur le compte utilisateur.
   */
  private buildStrategyParamsForm(
    params: StrategyParameter[],
    existingValues?: Record<string, any>,
  ): void {
    const scalars = params.filter((param) => param.type !== 'rule-builder');
    const controls: Record<string, FormControl> = {};

    for (const param of scalars) {
      const savedValue = existingValues?.[param.id];
      const initialValue = savedValue !== undefined ? savedValue : param.defaultValue;

      const validators = [];
      if (param.type === 'number') {
        validators.push(Validators.required);
      }

      controls[param.id] = this.fb.nonNullable.control(initialValue, validators);
    }

    this.strategyParamsForm.set(this.fb.group(controls));
    this.currentStrategyParams.set(scalars);
  }

  // ------------------------------------------------------------------
  //  Lifecycle
  // ------------------------------------------------------------------

  constructor() {
    addIcons({
      closeOutline,
      checkmarkOutline,
      closeCircle,
      removeOutline,
      addOutline,
      chevronForwardOutline,
    });

    // Reconstruction du form dynamique à chaque changement de strategy
    effect(() => {
      const strategy = this.formValue().strategy;
      const params = strategy?.parameters ?? [];
      this.buildStrategyParamsForm(params);
    });
  }

  ngOnInit(): void {
    this.prefillFromEditedPair();

    this.form.controls.exchangeKey.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.controls.pairName.updateValueAndValidity({ emitEvent: false });
      });

    this.loadMetadata();

    combineLatest([
      this.form.controls.exchangeKey.valueChanges,
      this.form.controls.pairName.valueChanges,
    ])
      .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
      .subscribe(([exchangeKey, pairName]) => {
        this.loadCapital(exchangeKey, pairName);
      });
  }

  /**
   * Recopie la paire éditée dans le formulaire, **une seule fois**.
   *
   * Ce pré-remplissage vivait dans un `effect`, qui se ré-exécutait à chaque
   * fermeture d'une modale ouverte par-dessus celle-ci : tout ce que
   * l'utilisateur avait saisi entre-temps repartait aux valeurs enregistrées.
   * Le défaut passait inaperçu tant que la seule sous-modale était le sélecteur
   * de marché, qui réécrit `pairName` après coup ; le builder de règles, lui,
   * voyait ses règles effacées en revenant. Hydrater n'est pas dériver : ça se
   * fait à l'ouverture, pas à chaque notification.
   *
   * `strategy` est volontairement absent du patch : le contrôle porte une
   * `StrategyMeta` (le *schéma* du formulaire), que seul `/exchanges/meta`
   * fournit — voir `resolveEditedStrategy`, appelé une fois le catalogue chargé.
   */
  private prefillFromEditedPair(): void {
    const pair = this.editPair();
    if (!pair) return;

    this.form.patchValue({
      exchangeKey: this.editExchangeKey() ?? '',
      pairName: pair.name,
      ratio: pair.ratio,
      interval: pair.interval,
      enabled: pair.enabled,
      exitBehavior: pair.exitBehavior ?? 'STRATEGY_SIGNAL',
    });

    this.ruleDocument.set(
      pair.strategy?.rules ? toStrategyDocument(pair.strategy, generateStrategyId()) : null,
    );
  }

  // ------------------------------------------------------------------
  //  UI helpers
  // ------------------------------------------------------------------

  async openMarketPicker(): Promise<void> {
    // TODO: Should depend on the selected exchange
    const modal = await this.modalCtrl.create({
      component: MarketPickerModalComponent,
      componentProps: {
        exchange: () => this.form.controls.exchangeKey.value,
        initialValue: () => this.form.controls.pairName.value,
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<string>();
    if (role === 'confirm' && data) {
      this.form.patchValue({ pairName: data });
    }
  }

  compareStrategies = (s1: StrategyMeta, s2: StrategyMeta): boolean =>
    s1 && s2 ? s1.shortname === s2.shortname : s1 === s2;

  readonly pinFormatter = (value: number) => `${value}%`;

  adjustRatio(delta: number): void {
    const current = this.form.getRawValue().ratio;
    const next = Math.min(100, Math.max(0, current + delta));
    this.form.patchValue({ ratio: next });
  }

  // ------------------------------------------------------------------
  //  Rules
  // ------------------------------------------------------------------

  /** Reprend une stratégie de la bibliothèque locale — la paire en garde un instantané. */
  async pickRules(): Promise<void> {
    const current = this.ruleDocument();
    await this.library.load();

    const modal = await this.modalCtrl.create({
      component: StrategyPickerModalComponent,
      componentProps: {
        multiple: () => false,
        attachedIds: () => (current ? [current.id] : []),
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<string[]>();
    if (role !== 'confirm' || !data?.length) return;

    const document = this.library.getById(data[0]);
    if (!document) return;

    this.ruleDocument.set(document);
    this.serverIssues.set([]);
  }

  /**
   * Ouvre le builder sur les règles de cette paire, avec les branches que le
   * catalogue déclare pour la stratégie choisie.
   *
   * Le builder enregistre dans la bibliothèque locale : éditer les règles
   * d'une paire l'y fait donc entrer si elle n'y était pas — le cas d'une paire
   * configurée depuis un autre appareil, dont les règles arrivent du compte et
   * non du stockage local. C'est préférable à un second éditeur qui saurait
   * modifier un arbre hors bibliothèque.
   */
  async editRules(): Promise<void> {
    const current =
      this.ruleDocument() ??
      toStrategyDocument(
        { name: this.draftRuleName(), shortname: this.form.getRawValue().strategy.shortname },
        generateStrategyId(),
      );

    const modal = await this.modalCtrl.create({
      component: StrategyBuilderModalComponent,
      componentProps: {
        initialDocument: () => current,
        branches: () => this.ruleBranches(),
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<StrategyDocument>();
    if (role !== 'confirm' || !data) return;

    this.ruleDocument.set(data);
    this.serverIssues.set([]);
  }

  /** Nom proposé pour une stratégie créée depuis une paire. */
  private draftRuleName(): string {
    const pairName = this.form.getRawValue().pairName;
    return pairName ? `${pairName} rules` : 'New strategy';
  }

  // ------------------------------------------------------------------
  //  Modal actions
  // ------------------------------------------------------------------

  async submit(): Promise<void> {
    if (!this.isValid() || this.validating()) return;

    const formValue = this.form.getRawValue();
    const settings = this.strategyParamsForm().getRawValue() as StrategySettings;
    const strategy = this.buildStrategy(formValue.strategy, settings);

    if (this.usesRules() && !(await this.approvedByBot(strategy))) return;

    const result: TradingPairModalResult = {
      exchangeKey: formValue.exchangeKey,
      pair: {
        name: formValue.pairName,
        ratio: formValue.ratio,
        interval: formValue.interval,
        enabled: formValue.enabled,
        strategy,
        exitBehavior: formValue.exitBehavior,
      },
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  // ------------------------------------------------------------------
  //  Private helpers
  // ------------------------------------------------------------------

  /**
   * La stratégie telle qu'elle sera enregistrée sur le compte : des données
   * métier, aucune métadonnée d'affichage.
   *
   * `StrategyMeta.parameters` décrit un formulaire ; le recopier dans la
   * configuration y faisait vieillir une copie du catalogue. Les valeurs
   * saisies, elles, se rangent selon le contrat des types partagés :
   * `rule-builder` alimente `rules`, les scalaires alimentent `settings`.
   *
   * `latent` et `protective` appartiennent à la paire et non au choix de
   * stratégie : les reconduire évite que changer de stratégie efface en
   * silence les TP/SL réglés dans la modale Protective.
   */
  private buildStrategy(meta: StrategyMeta, settings: StrategySettings): IExchangeStrategy {
    const previous = this.editPair()?.strategy;
    const document = this.ruleDocument();

    return {
      name: meta.name,
      shortname: meta.shortname,
      ...(meta.description ? { description: meta.description } : {}),
      ...(this.usesRules() && document ? { rules: pruneEmptyRuleBranches(document.rules) } : {}),
      ...(Object.keys(settings).length > 0 ? { settings } : {}),
      ...(previous?.latent ? { latent: previous.latent } : {}),
      ...(previous?.protective ? { protective: previous.protective } : {}),
    };
  }

  /**
   * Verdict du bot avant d'écrire la paire sur le compte utilisateur.
   *
   * La validation locale ne suffit pas : elle s'appuie sur une copie compilée
   * des catalogues, que le bot peut avoir dépassée. Un refus garde la modale
   * ouverte, pour que le rapport soit lu plutôt qu'emporté par la fermeture.
   *
   * Bot injoignable : on avertit et on laisse passer, comme le builder. Une
   * paire mal formée sera de toute façon refusée à l'exécution, alors qu'un
   * blocage rendrait la configuration impossible dès que le service tousse.
   */
  private async approvedByBot(strategy: IExchangeStrategy): Promise<boolean> {
    this.validating.set(true);
    this.serverIssues.set([]);

    try {
      const result = await firstValueFrom(this.botService.validateStrategy(strategy));
      if (result.valid) return true;

      this.serverIssues.set(result.issues);
      await this.toast('The bot rejected these rules — see below.', 'danger');
      return false;
    } catch {
      await this.toast('The bot could not be reached to validate these rules.', 'warning');
      return true;
    } finally {
      this.validating.set(false);
    }
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, color, duration: 4000 });
    await toast.present();
  }
}
