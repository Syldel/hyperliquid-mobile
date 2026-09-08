import { Component, EventEmitter, forwardRef, Injectable, Input, Output } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Remplaçants minimalistes des composants/services Ionic. Un spec n'a rien à
 * déclarer pour en bénéficier : `vitest.config.ts` fait pointer
 * `@ionic/angular/standalone` et `@ionic/angular` sur ce fichier, dont les
 * ré-exports en bas portent les noms réels d'Ionic.
 *
 * Nécessaires tant que
 * https://github.com/ionic-team/ionic-framework/issues/30982 (import ESM
 * cassé de @ionic/core sous Vitest, @ionic/core@8.8.2 sans champ "exports")
 * n'est pas corrigé en amont : importer QUOI QUE CE SOIT de
 * `@ionic/angular/standalone` OU `@ionic/angular` charge tout son bundle
 * respectif, y compris la ligne d'import cassée — au moment même où le
 * fichier du composant testé est chargé, avant même que TestBed n'entre en
 * jeu. Aucun schéma Angular (`CUSTOM_ELEMENTS_SCHEMA`) ni
 * `TestBed.overrideComponent` ne peut intercepter ça après coup : seule une
 * substitution au niveau du module empêche le vrai bundle Ionic d'être chargé.
 *
 * Volontairement minimalistes (sélecteur + projection de contenu pour les
 * conteneurs) : ces specs testent la logique du composant sous test, pas le
 * comportement réel des composants Ionic — c'est aussi une pratique de test
 * saine indépendamment du bug ci-dessus. À enrichir au fur et à mesure des
 * besoins réels d'un nouveau spec (nouveau tag, nouvel input/output
 * effectivement lu par le composant testé), pas par anticipation. Exception :
 * un `@Input()` lié par binding de propriété (`[disabled]="..."`, pas
 * `disabled=""` statique) DOIT être déclaré, sous peine d'erreur de
 * compilation du template (`strictTemplates`), pas seulement d'exécution.
 */

@Component({
  selector: 'ion-item-sliding',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonItemSlidingStub {}

@Component({
  selector: 'ion-item',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonItemStub {}

@Component({
  selector: 'ion-item-options',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonItemOptionsStub {}

@Component({
  selector: 'ion-item-option',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonItemOptionStub {}

@Component({
  selector: 'ion-label',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonLabelStub {}

@Component({
  selector: 'ion-icon',
  standalone: true,
  template: '',
})
export class IonIconStub {}

@Component({
  selector: 'ion-button',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonButtonStub {
  // Lié via `[disabled]="..."` dans wallet-form.html : binding de propriété,
  // pas un attribut statique — doit être un @Input déclaré (voir note plus haut).
  @Input() disabled = false;
}

@Component({
  selector: 'ion-spinner',
  standalone: true,
  template: '',
})
export class IonSpinnerStub {}

/**
 * `ion-input` participe à Angular Forms via `formControlName` dans
 * wallet-form.html : `FormControlName` cherche un `ControlValueAccessor`
 * enregistré sur l'élément hôte et échoue (`NG01203`) s'il n'en trouve
 * aucun. Implémentation minimale — pas de synchronisation de valeur réelle,
 * seulement de quoi satisfaire le contrat que Forms exige pour s'attacher.
 */
@Component({
  selector: 'ion-input',
  standalone: true,
  template: '',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => IonInputStub),
      multi: true,
    },
  ],
})
export class IonInputStub implements ControlValueAccessor {
  // Liés par binding dans les templates du builder (`[value]`, `(ionInput)`) :
  // sous `strictTemplates`, ils doivent être déclarés ici pour que ces
  // templates compilent contre le stub.
  @Input() value: unknown;
  @Input() label = '';
  @Input() labelPlacement = '';
  @Input() type = 'text';
  @Output() ionInput = new EventEmitter<{ detail: { value: string | null } }>();

  writeValue(): void {}
  registerOnChange(): void {}
  registerOnTouched(): void {}
}

/**
 * Stub de service (pas un composant) : `@ionic/angular` (module classique,
 * distinct de `/standalone`) exporte `Platform`, une classe injectable
 * utilisée via `inject(Platform)` — pas un sélecteur de template.
 * `@Injectable({ providedIn: 'root' })` est nécessaire : la vraie `Platform`
 * est tree-shakable de la même façon, et sans ça Angular DI n'a aucun
 * provider enregistré pour le jeton (`NG0201`). Seule `.ready()` est
 * implémentée : c'est la seule méthode appelée par `AppComponent`
 * aujourd'hui (voir la note "à enrichir au besoin" plus haut).
 */
@Injectable({ providedIn: 'root' })
export class PlatformStub {
  ready(): Promise<string> {
    return Promise.resolve('dom');
  }
}

@Component({
  selector: 'ion-chip',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonChipStub {}

@Component({
  selector: 'ion-badge',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonBadgeStub {}

/**
 * Contrôleurs d'overlay (`ModalController`, `ActionSheetController`) : des
 * services injectés, pas des sélecteurs — mêmes raisons que `PlatformStub`.
 *
 * `create()` renvoie un overlay inerte plutôt que `undefined` : un composant
 * qui enchaîne `present()` puis `onDidDismiss()` doit pouvoir le faire sans
 * planter, et un spec qui ne teste pas l'ouverture d'une modale n'a pas à
 * simuler davantage. Le rôle `cancel` renvoyé par défaut fait que l'appelant
 * conclut « l'utilisateur a annulé », donc n'écrit rien.
 */
@Injectable({ providedIn: 'root' })
export class ModalControllerStub {
  /** Arguments du dernier `dismiss()`, pour qu'un spec vérifie la fermeture. */
  readonly dismissed: { data: unknown; role?: string }[] = [];

  async create(): Promise<{
    present: () => Promise<void>;
    onDidDismiss: () => Promise<{ data: undefined; role: string }>;
  }> {
    return {
      present: async () => {},
      onDidDismiss: async () => ({ data: undefined, role: 'cancel' }),
    };
  }

  async dismiss(data?: unknown, role?: string): Promise<boolean> {
    this.dismissed.push({ data, role });
    return true;
  }
}

@Injectable({ providedIn: 'root' })
export class ActionSheetControllerStub extends ModalControllerStub {}

/** `ToastController` : seul `create().present()` est appelé par les composants du repo. */
@Injectable({ providedIn: 'root' })
export class ToastControllerStub {
  readonly messages: string[] = [];

  async create(options: { message: string }): Promise<{ present: () => Promise<void> }> {
    this.messages.push(options.message);
    return { present: async () => {} };
  }
}

/**
 * Conteneurs de mise en page : uniquement de la projection de contenu, aucun
 * comportement. Leurs attributs de présentation (`slot`, `inset`, `fill`,
 * `color`...) sont statiques dans les templates du repo, donc posés comme
 * attributs DOM sans exiger d'`@Input` déclaré.
 */
@Component({ selector: 'ion-header', standalone: true, template: '<ng-content></ng-content>' })
export class IonHeaderStub {}

@Component({ selector: 'ion-toolbar', standalone: true, template: '<ng-content></ng-content>' })
export class IonToolbarStub {}

@Component({ selector: 'ion-title', standalone: true, template: '<ng-content></ng-content>' })
export class IonTitleStub {}

@Component({ selector: 'ion-buttons', standalone: true, template: '<ng-content></ng-content>' })
export class IonButtonsStub {}

@Component({ selector: 'ion-content', standalone: true, template: '<ng-content></ng-content>' })
export class IonContentStub {}

@Component({ selector: 'ion-list', standalone: true, template: '<ng-content></ng-content>' })
export class IonListStub {}

@Component({ selector: 'ion-note', standalone: true, template: '<ng-content></ng-content>' })
export class IonNoteStub {}

@Component({ selector: 'ion-text', standalone: true, template: '<ng-content></ng-content>' })
export class IonTextStub {}

@Component({ selector: 'ion-fab', standalone: true, template: '<ng-content></ng-content>' })
export class IonFabStub {}

@Component({ selector: 'ion-fab-button', standalone: true, template: '<ng-content></ng-content>' })
export class IonFabButtonStub {}

/**
 * Contrôles de saisie : leurs `@Input`/`@Output` sont déclarés parce qu'ils
 * sont liés par binding (`[value]`, `(ionChange)`) dans les templates du
 * builder — sous `strictTemplates`, un binding vers une propriété non déclarée
 * est une erreur de compilation, pas seulement d'exécution.
 */
@Component({ selector: 'ion-select', standalone: true, template: '<ng-content></ng-content>' })
export class IonSelectStub {
  @Input() value: unknown;
  @Input() interface = '';
  @Input() placeholder = '';
  @Output() ionChange = new EventEmitter<{ detail: { value: unknown } }>();
}

@Component({
  selector: 'ion-select-option',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonSelectOptionStub {
  @Input() value: unknown;
}

@Component({ selector: 'ion-segment', standalone: true, template: '<ng-content></ng-content>' })
export class IonSegmentStub {
  @Input() value: unknown;
  @Output() ionChange = new EventEmitter<{ detail: { value: unknown } }>();
}

@Component({
  selector: 'ion-segment-button',
  standalone: true,
  template: '<ng-content></ng-content>',
})
export class IonSegmentButtonStub {
  @Input() value: unknown;
}

/**
 * ============================================================================
 * Ré-exports sous les noms réels d'Ionic.
 *
 * C'est la cible de l'alias déclaré dans `vitest.config.ts` : sous test,
 * `@ionic/angular/standalone` et `@ionic/angular` résolvent vers ce fichier.
 * Un alias est résolu au moment où le module est chargé, contrairement à
 * `vi.mock`, qui passe par un registre de mocks propre à chaque worker Vitest —
 * registre dont la résolution casse au-delà d'un certain nombre de fichiers de
 * spec en mode watch (voir l'historique de ce fichier et le README d'équipe).
 *
 * Conséquence pratique inchangée : un symbole importé par un composant testé
 * mais absent d'ici provoque une erreur de compilation. La liste s'enrichit
 * donc au besoin réel, exactement comme avant.
 * ============================================================================
 */
export {
  IonBadgeStub as IonBadge,
  IonButtonStub as IonButton,
  IonButtonsStub as IonButtons,
  IonChipStub as IonChip,
  IonContentStub as IonContent,
  IonFabStub as IonFab,
  IonFabButtonStub as IonFabButton,
  IonHeaderStub as IonHeader,
  IonIconStub as IonIcon,
  IonInputStub as IonInput,
  IonItemStub as IonItem,
  IonItemOptionStub as IonItemOption,
  IonItemOptionsStub as IonItemOptions,
  IonItemSlidingStub as IonItemSliding,
  IonLabelStub as IonLabel,
  IonListStub as IonList,
  IonNoteStub as IonNote,
  IonSegmentStub as IonSegment,
  IonSegmentButtonStub as IonSegmentButton,
  IonSelectStub as IonSelect,
  IonSelectOptionStub as IonSelectOption,
  IonSpinnerStub as IonSpinner,
  IonTextStub as IonText,
  IonTitleStub as IonTitle,
  IonToolbarStub as IonToolbar,
  ActionSheetControllerStub as ActionSheetController,
  ModalControllerStub as ModalController,
  ToastControllerStub as ToastController,
  PlatformStub as Platform,
};
