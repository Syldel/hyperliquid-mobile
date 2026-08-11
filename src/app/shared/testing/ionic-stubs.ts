import { Component, forwardRef, Injectable, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Remplaçants minimalistes des composants/services Ionic, à mocker dans les
 * specs via `vi.mock('@ionic/angular/standalone', () => ({ IonItem: IonItemStub, ... }))`
 * (composants) ou `vi.mock('@ionic/angular', () => ({ Platform: PlatformStub }))`
 * (services du module classique — voir `PlatformStub` plus bas).
 *
 * Nécessaires tant que
 * https://github.com/ionic-team/ionic-framework/issues/30982 (import ESM
 * cassé de @ionic/core sous Vitest, @ionic/core@8.8.2 sans champ "exports")
 * n'est pas corrigé en amont : importer QUOI QUE CE SOIT de
 * `@ionic/angular/standalone` OU `@ionic/angular` charge tout son bundle
 * respectif, y compris la ligne d'import cassée — au moment même où le
 * fichier du composant testé est chargé, avant même que TestBed n'entre en
 * jeu. Aucun schéma Angular (`CUSTOM_ELEMENTS_SCHEMA`) ni
 * `TestBed.overrideComponent` ne peut intercepter ça après coup : seul un
 * mock au niveau du module (Vitest) empêche le vrai bundle Ionic d'être
 * chargé.
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
