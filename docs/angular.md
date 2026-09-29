# Angular 21 dans ce projet

## Le biais par défaut

**L'Angular moderne est la norme ici ; l'Angular historique est du code de compatibilité.**
Devant plusieurs implémentations possibles, prendre la moderne sans demander — et si
l'ancienne se justifie, l'écrire et dire pourquoi.

Ce n'est pas une intention, c'est l'état du code. Compté le 2026-09-29 sur `src/app`,
**hors `*.spec.ts` et hors `shared/testing/`** :

|                 | moderne                                                     | ancien                                        |
| --------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `@angular/core` | **21.2.24**, `zone.js` absent même en transitif             |                                               |
| Composants      | 51, tous standalone                                         | **0 `NgModule`**                              |
| Gabarits        | 188 `@if`, 80 `@for`, 6 `@let`, 4 `@empty`                  | **0 `*ngIf`, `*ngFor`, `ngClass`, `ngStyle`** |
| Injection       | 163 `inject()` dans 55 fichiers                             | 2 `constructor(private …)`                    |
| Entrées         | 38 `input()`, dont 18 `input.required()`                    | **0 `@Input()`**                              |
| Sorties         | 13 `output()` dans 10 fichiers                              | **0 `@Output()`, 0 `EventEmitter`**           |
| Signaux         | 185 `signal`, 154 `computed`, 20 `effect`, 3 `linkedSignal` |                                               |
| Références      | 5 `viewChild()`, 2 `contentChild()`                         | **0 `@ViewChild`**                            |

La portée compte : les seuls `@Input()`, `@Output()` et `EventEmitter` du dépôt vivent
dans `shared/testing/ionic-stubs.ts`, et c'est voulu (voir plus bas).

Autrement dit : introduire un `@Input()`, un `*ngIf`, un `NgModule` ou une injection par
constructeur serait une **régression**, pas un choix de style.

## Avant d'écrire, la question à se poser

| La chose à écrire est…                              | →                                                    | Précédent dans le projet                                                                             |
| --------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| un état local qui change                            | `signal()`                                           | partout                                                                                              |
| une valeur **dérivée** d'un autre état              | `computed()`                                         | `bot.service.ts` — 154 dans le dépôt                                                                 |
| un état dérivé mais qu'on doit pouvoir **réécrire** | `linkedSignal()`                                     | `hyperliquid-cache.service.ts`                                                                       |
| un état **asynchrone en lecture**                   | `resource()`                                         | `hyperliquid-cache.service.ts` — voir plus bas                                                       |
| un effet de bord, et rien d'autre ne convient       | `effect()`                                           | [« Un effet dérive, il n'hydrate pas »](conventions.md#un-effet-dérive-il-nhydrate-pas)              |
| une entrée de composant                             | `input()` / `input.required()`                       | ⚠️ [« Une entrée de modale se lit »](conventions.md#une-entrée-de-modale-se-lit-elle-ne-se-suit-pas) |
| une sortie de composant                             | `output()`                                           | `wallet-item.component.ts`                                                                           |
| une dépendance injectée                             | `inject()`                                           | partout                                                                                              |
| une référence au gabarit                            | `viewChild()` / `contentChild()`                     | `mini-chart.component.ts`                                                                            |
| un rendu conditionnel ou répété                     | `@if` / `@for` (avec `track`) / `@switch` / `@empty` | partout                                                                                              |
| une valeur intermédiaire dans un gabarit            | `@let`                                               | `watchlist-detail.page.html`                                                                         |
| un flux RxJS existant à **afficher**                | `toSignal()`                                         | `token-expiry.component.ts`                                                                          |
| un nouveau composant                                | standalone — c'est le défaut, ne rien écrire         |                                                                                                      |

Une règle transversale : **un `computed` n'écrit jamais, un `effect` ne calcule jamais.**
Un `effect` qui pose un signal dérivable est un `computed` qui s'ignore, et c'est ainsi
qu'un formulaire d'édition a effacé la saisie de l'utilisateur pendant des mois.

## `resource()` : lecture seule, et c'est Angular qui le dit

Le projet en a trois, tous dans `hyperliquid-cache.service.ts`, et leur forme est le
modèle à reprendre : des `params` calculés depuis des signaux avec un `equal` explicite,
un `loader` qui `firstValueFrom` l'appel HTTP.

⚠️ **Ne jamais envelopper un ordre dans un `resource()`.** La documentation d'Angular est
explicite dans ses propres types :

> `resource` is intended for _read_ operations, not operations which perform mutations.
> `resource` will cancel in-progress loads via the `AbortSignal` […] which could
> prematurely abort mutations.

Une écriture annulée en vol, sur cette app, c'est un ordre dont on ignore l'état. Les
mutations restent des appels explicites.

⚠️ **`httpResource` est marqué `@experimental 19.2`** dans `@angular/common` 21.2.24
(vérifié dans `types/http.d.ts`). Il n'est utilisé nulle part ici. L'introduire est une
décision à prendre avec l'utilisateur, pas un raffinement à glisser dans un correctif.

## Ce qui reste en ancien, et qui a le droit d'y rester

Ne pas « moderniser » ceci sans demande explicite :

- **`shared/testing/ionic-stubs.ts`** concentre **tous** les `@Input()`, `@Output()` et
  `EventEmitter` du dépôt. C'est délibéré : ces faux composants imitent l'API d'Ionic,
  qui est décoratrice. Les moderniser les rendrait infidèles ;
- **deux `BehaviorSubject`** (`auth.service.ts`, `config.service.ts`) exposés en `$` et
  consommés en RxJS par du code qui n'est pas un gabarit.

## Les 38 `.subscribe()` : ce qu'ils sont vraiment

Compté le 2026-09-29 : **7 portent une borne** (`takeUntilDestroyed`, `take(1)`,
`firstValueFrom`) et **31 n'en portent aucune**. Avant d'en « corriger » un, regarder de
quel flux il s'agit — les trois cas n'appellent pas la même réponse :

- un flux **borné par nature** (`route.queryParamMap` avec `takeUntilDestroyed`,
  `interval(60_000)`) : rien à faire ;
- un **observable HTTP** — la grande majorité des 31. Il complète de lui-même, donc pas de
  souscription qui traîne ; le rappel peut seulement s'exécuter après destruction du
  composant, ce qui écrit dans des signaux que plus personne ne lit. Quand un tel appel
  alimente un **état affiché**, c'est un `resource()` qui devrait le porter, et c'est là
  qu'est la vraie modernisation — pas dans l'ajout d'un `takeUntilDestroyed` ;
- `form.valueChanges` (trois fois dans `indicator-picker.component.ts`) : ce flux **ne
  complète jamais**. Ici le `FormGroup` est reconstruit entier à chaque sélection et rien
  ne s'accumule — mais c'est le seul endroit où un oubli de borne coûterait quelque chose,
  et la prudence veut qu'on en pose une si ce code bouge.

⚠️ Aucune fuite n'a été **mesurée** : ce qui précède est une lecture du code, pas un
relevé mémoire.

## Ce qui est de l'ancien et mériterait de partir

À traiter quand on passe à côté, pas comme un chantier :

- **`constructor(private …)` dans deux services** : `config.service.ts` et
  `theme.service.ts` ;
- **`standalone: true` écrit 52 fois** alors que c'est le défaut depuis Angular 19. Bruit
  pur, à retirer au fil de l'eau ;
- **`ChangeDetectionStrategy.OnPush` sur 18 composants applicatifs sur 51.** En zoneless
  la détection ne part que d'un signal ou d'une liaison d'évènement, donc c'est un
  raffinement de performance et non une question de correction — mais l'écart mérite
  d'être comblé plutôt que documenté comme s'il n'existait pas.

## Un précédent de conversion : l'intercepteur HTTP

`app.config.ts` déclarait `provideHttpClient(withInterceptorsFromDi())` plus un
`HTTP_INTERCEPTORS`, et `AuthInterceptor` était une classe. C'est désormais
`withInterceptors([authInterceptor])` et une `HttpInterceptorFn`, dont la signature typée
`HttpRequest<unknown>` a fait disparaître les deux `any` au passage.

La méthode vaut plus que le résultat, parce qu'elle se réemploie : **on ne convertit pas
du code qui n'a pas de test.** L'ordre suivi le 2026-09-29 a été d'écrire d'abord les
tests sur la version par classe, puis de convertir, puis de vérifier que **le même compte
et les mêmes assertions** passent — 527 tests avant, 527 après. Sans cette étape, une
conversion est un pari sur du code qu'on ne regarde plus.

Puis les huit mutations ont été rejouées sur la forme fonctionnelle : toutes tombent, donc
la conversion n'a pas émoussé la suite. Une mutation qui cesse de faire rougir après un
refactoring signale un test devenu décoratif.

## Les pièges qui ont déjà coûté quelque chose ici

Ils sont dans [conventions.md](conventions.md), nés d'incidents datés, et ils priment sur
toute intuition générale d'Angular :

- [**l'app est zoneless**](conventions.md#cette-app-est-zoneless--rien-ne-se-repeint-tout-seul) :
  un `control.setValue()` n'affiche rien, et `NgZone.run()` ne répare plus rien ;
- [**une entrée de modale se lit, elle ne se suit pas**](conventions.md#une-entrée-de-modale-se-lit-elle-ne-se-suit-pas) :
  Ionic écrase la propriété, le signal n'est plus un signal ;
- [**un effet dérive, il n'hydrate pas**](conventions.md#un-effet-dérive-il-nhydrate-pas) :
  pré-remplir un formulaire se fait dans `ngOnInit`.
