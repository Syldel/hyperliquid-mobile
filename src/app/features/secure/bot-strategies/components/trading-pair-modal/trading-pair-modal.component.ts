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
  alertCircleOutline,
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
import { toLocalIssuePath } from '../../../strategies/domain/strategy-path.util';
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
import {
  exchangeCatalogue,
  judgeableCatalogue,
  offeredStrategies,
  resolveStrategyMeta,
} from '../../domain/exchange-catalogue.util';
import {
  isKnownUnexecutable,
  pairStrategyStatus,
  type PairStrategyStatus,
} from '../../domain/pair-strategy-status.util';

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

  /** Voir `prefillFromEditedPair` : l'hydratation n'a lieu qu'une fois. */
  private prefilled = false;
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
  availableExchanges = signal<string[]>([]);
  strategiesByExchange = signal<Record<string, StrategyMeta[]>>({});
  metadataError = signal(false);
  /**
   * Le catalogue a répondu — distinct de « la liste est vide ».
   *
   * Sans ce drapeau, `strategiesByExchange()` vaut `{}` avant la réponse, ce
   * qu'une lecture naïve prendrait pour « le bot ne propose rien » : toute
   * paire saine serait signalée comme abandonnée le temps du chargement. C'est
   * `catalogueFor` qui le traduit en `null`, le seul état sur lequel ce build
   * s'interdit de juger.
   */
  metadataLoaded = signal(false);
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

  /**
   * Le catalogue **tel qu'il n'a pas encore répondu**, ou tel qu'il a répondu.
   *
   * Nommé plutôt que reconstruit à chaque appel : `exchangeCatalogue` distingue
   * quatre situations, et les trois consommateurs ci-dessous doivent partir de
   * la même. C'est ici que `metadataLoaded` se traduit en `null` — « le bot n'a
   * rien dit », par opposition à « le bot n'a rien à proposer ».
   */
  private catalogueFor(exchangeKey: string | undefined) {
    return exchangeCatalogue(
      this.metadataLoaded() ? this.strategiesByExchange() : null,
      exchangeKey,
    );
  }

  /** Catalogue de l'exchange **que le formulaire porte en ce moment**. */
  readonly formCatalogue = computed(() => this.catalogueFor(this.formValue().exchangeKey));

  /**
   * Catalogue de l'exchange **sous lequel la paire est enregistrée**.
   *
   * Distinct du précédent : changer d'exchange dans le formulaire ne change
   * pas là où la paire dort. Juger la stratégie enregistrée sur le catalogue
   * du nouvel exchange produirait une accusation fausse au premier changement.
   */
  private readonly storedCatalogue = computed(() => this.catalogueFor(this.editExchangeKey()));

  /**
   * Options du sélecteur de stratégie — celles de cet exchange, et rien
   * d'autre. Un repli sur le catalogue aplati proposerait les stratégies d'un
   * autre exchange ; voir `exchange-catalogue.util.ts`.
   */
  readonly filteredStrategies = computed(() => offeredStrategies(this.formCatalogue()));

  /**
   * L'exchange choisi pour lequel le bot ne déclare aucune stratégie, s'il y
   * en a un. Le sélecteur est alors vide **et le dit** : sans ce message, un
   * champ sans options serait indiscernable d'un catalogue en cours de
   * chargement ou d'un bug d'affichage.
   */
  readonly undeclaredExchange = computed(() => {
    const catalogue = this.formCatalogue();
    return catalogue.state === 'undeclared' ? catalogue.exchangeKey : null;
  });

  /**
   * La paire enregistrée l'est sur un exchange que le bot ne sert plus.
   *
   * `storedStrategyStatus` rend alors `unknown-shortname` — correct quant à
   * l'exécution, mais « cette stratégie n'est plus proposée » désignerait le
   * mauvais coupable. La bannière substitue le vrai motif.
   */
  readonly storedExchangeUndeclared = computed(
    () => !!this.editPair() && this.storedCatalogue().state === 'undeclared',
  );

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
   * Statut de la stratégie **enregistrée** sur la paire éditée, par opposition
   * à celle que le formulaire porte en ce moment.
   *
   * `unverified` en création, et tant que le catalogue n'a pas répondu : il
   * n'y a rien dont ce build puisse juger, et le dire vaut mieux que rendre un
   * verdict par défaut. Le tri est délégué à `pairStrategyStatus` plutôt que
   * gardé ici par `metadataLoaded` — une paire sans `shortname` du tout est
   * alors signalée sans attendre le réseau, ce qui est certain de toute façon.
   *
   * Le catalogue consulté est celui de l'exchange **enregistré**, pas celui du
   * formulaire : sans quoi changer d'exchange ferait juger la paire sur un
   * catalogue qui n'est pas le sien.
   */
  readonly storedStrategyStatus = computed<PairStrategyStatus>(() => {
    const pair = this.editPair();
    if (!pair) return 'unverified';
    return pairStrategyStatus(pair.strategy, judgeableCatalogue(this.storedCatalogue()));
  });

  /**
   * La bannière explique **pourquoi le sélecteur est vide** : elle disparaît
   * donc dès qu'une stratégie est choisie, sans quoi elle décrirait un état
   * que l'écran ne montre plus. Le formulaire reste invalide tant que rien
   * n'est choisi — la réparation est proposée, jamais appliquée d'office.
   */
  readonly showStalledStrategy = computed(
    () => isKnownUnexecutable(this.storedStrategyStatus()) && !this.formValue().strategy,
  );

  /**
   * Note expliquant un sélecteur vide **par l'exchange choisi**, et non par la
   * paire enregistrée.
   *
   * Elle couvre ce que la bannière ne couvre pas : une création sur un exchange
   * que le bot ne sert pas, ou un changement d'exchange en cours d'édition.
   * Effacée quand la bannière dit déjà la même chose, pour ne pas écrire deux
   * fois le même diagnostic à deux centimètres d'écart.
   */
  readonly showUndeclaredExchange = computed(
    () =>
      !!this.undeclaredExchange() &&
      !(this.showStalledStrategy() && this.storedExchangeUndeclared()),
  );

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
        this.metadataLoaded.set(true);
        this.candleIntervals.set(meta.intervals);
        this.availableExchanges.set(meta.exchanges);
        this.strategiesByExchange.set(meta.strategies);
        this.exitBehaviors.set(meta.globalOptions?.exitBehaviors ?? []);

        this.form.controls.strategy.enable();
        this.form.controls.interval.enable();
        this.resolveEditedStrategy();
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
   *
   * La recherche porte sur le catalogue de **l'exchange de la paire**, pas sur
   * l'aplatissement de tous les exchanges : celui-ci pouvait charger le
   * sélecteur d'une valeur absente de ses propres options, et le ferait dès
   * que le bot en déclarerait un second. La clé est relue sur le formulaire
   * (`getRawValue`) plutôt que sur `formValue()`, pour ne pas dépendre de
   * l'ordre d'émission des `valueChanges` d'un contrôle qu'on vient
   * d'activer.
   */
  /**
   * Changer d'exchange abandonne une stratégie que le nouveau ne propose pas.
   *
   * Sans cela, le contrôle gardait la `StrategyMeta` de l'exchange précédent :
   * un `ion-select` portant une valeur absente de ses options, et `submit` qui
   * écrivait sur la paire un `shortname` que le bot n'aiguille pas sur cet
   * exchange. Le symptôme est celui du catalogue aplati, atteint sans même
   * éditer une paire.
   *
   * L'abandon est annoncé : vider un champ sans un mot serait la défaillance
   * muette que ce dépôt refuse. Les règles déjà construites, elles, sont
   * conservées — elles appartiennent à l'utilisateur, `usesRules()` les exclut
   * de l'enregistrement tant qu'aucune stratégie ne les réclame, et revenir en
   * arrière doit les retrouver.
   *
   * `not-loaded` ne déclenche rien : effacer un choix sur une absence de
   * réponse serait un verdict rendu sans autorité.
   */
  private dropStrategyNotOfferedBy(exchangeKey: string): void {
    const selected = this.form.getRawValue().strategy;
    if (!selected) return;

    const catalogue = this.catalogueFor(exchangeKey);
    if (catalogue.state === 'not-loaded') return;
    if (resolveStrategyMeta(catalogue, selected.shortname)) return;

    this.form.controls.strategy.reset();
    void this.toast(
      catalogue.state === 'no-exchange'
        ? `“${selected.name}” was cleared — pick an exchange first.`
        : `“${selected.name}” is not offered on ${exchangeKey}.`,
      'warning',
    );
  }

  private resolveEditedStrategy(): void {
    const catalogue = this.catalogueFor(this.form.getRawValue().exchangeKey);
    const meta = resolveStrategyMeta(catalogue, this.editPair()?.strategy?.shortname);

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
      alertCircleOutline,
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
      .subscribe((exchangeKey) => {
        this.form.controls.pairName.updateValueAndValidity({ emitEvent: false });
        this.dropStrategyNotOfferedBy(exchangeKey);
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
   *
   * Le drapeau ne protège pas d'un second `ngOnInit`, qu'Angular n'appelle pas :
   * il fait de « hydrater une fois » une propriété de cette méthode plutôt
   * qu'une conséquence de l'endroit d'où on l'appelle. C'est ce qui la rend
   * vérifiable sans rejouer le cycle de vie d'une modale Ionic, et ce qui
   * empêche le défaut de revenir par un autre déclencheur.
   */
  private prefillFromEditedPair(): void {
    if (this.prefilled) return;

    const pair = this.editPair();
    if (!pair) return;

    this.prefilled = true;

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
    const modal = await this.modalCtrl.create({
      component: MarketPickerModalComponent,
      componentProps: {
        exchangeKey: () => this.form.controls.exchangeKey.value,
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

  /**
   * Chemin d'une anomalie dans le vocabulaire de l'éditeur de règles.
   *
   * Le serveur situe depuis la stratégie entière (`strategy.rules.long…`), ce
   * qui ne correspond à rien de ce que l'utilisateur voit. Une anomalie hors de
   * l'arbre garde son chemin d'origine.
   */
  issuePath(issue: PublicStrategyValidationIssue): string {
    return toLocalIssuePath(issue.path) ?? issue.path;
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
