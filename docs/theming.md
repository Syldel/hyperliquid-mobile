# Thème

## Deux couleurs, et tout le reste s'en déduit

`src/theme/variables.scss` part de quatre valeurs — un fond et un texte, en clair
et en sombre :

```scss
$light-background: #feffff;
$light-text: #1d1d1d;
$dark-background: #1d1d1d;
$dark-text: #feffff;
```

Les **dix-neuf paliers** qu'Ionic interpole entre le fond et le texte
(`--ion-background-color-step-50` … `-950`, et leurs symétriques
`--ion-text-color-step-*`) ne sont plus écrits à la main : `stepped-colors` les
calcule, par pas de 5 %. Un palier est un point sur le segment qui va du fond au
texte, rien d'autre.

Trente-huit valeurs hexadécimales étaient auparavant collées dans `:root`. Elles
étaient justes, mais plus rien ne disait de quoi elles descendaient — et elles
n'existaient **que pour le thème clair**.

> Vérifié le 2026-09-29 en comparant les CSS compilés avant et après : les
> trente-huit paliers clairs sortent avec exactement les mêmes canaux. Seule la
> notation change (`rgb(243, 244, 244)` là où on lisait `#f3f4f4`) : depuis
> Sass 1.79, une couleur calculée n'est plus réémise en hexadécimal.

## La règle : le sombre vit à un seul endroit

**Deux chemins** mènent au thème sombre, et c'est la source de tous les ennuis
qu'a connus ce fichier :

| Chemin        | Quand                                         | Sélecteur                             |
| ------------- | --------------------------------------------- | ------------------------------------- |
| classe        | l'utilisateur a choisi « dark » explicitement | `.dark-theme`                         |
| requête média | mode `auto` — **le défaut**                   | `@media (prefers-color-scheme: dark)` |

`ThemeService.applyTheme` n'ajoute `dark-theme` ni `light-theme` **que** pour un
choix explicite (`currentTheme !== 'auto'`). Un utilisateur qui n'a jamais
touché au réglage passe donc par la requête média, pas par la classe.

Les deux branches appliquent maintenant le **même mixin**, `dark-mode-vars`.
C'est la règle : tout ce qui distingue le sombre du clair y vit, et nulle part
ailleurs. Vérifié le 2026-09-29 sur le CSS compilé — **100 déclarations de
chaque côté, identiques**.

Ce qu'il ne faut plus refaire : `@extend` une palette externe dans une seule des
deux branches. C'était le cas — `.dark-theme` recevait
`@ionic/core/css/palettes/dark.class.css` (paliers et couleurs sémantiques
comprises), la requête média ne recevait que quatre variables. Le sombre était
donc **appliqué à moitié** pour qui ne l'avait pas choisi à la main.

La palette Ionic n'est plus importée : ce qu'elle apportait d'utile est recopié
dans `dark-mode-vars`, avec sa source et sa version en commentaire.

### Une règle qui ne vaut qu'en sombre

Elle ne s'écrit pas à la main dans l'une des deux branches — c'est la faute
d'origine. Le mixin `when-dark` les produit toutes les deux depuis un seul
appel :

```scss
@include when-dark {
  ion-chip.ion-color {
    color: var(--ion-color-base);
  }
}
```

Vérifié le 2026-09-29 : les deux chemins rendent les mêmes douze valeurs de
contraste, et le clair reste identique à ce qu'il était.

## Ce que le défaut coûtait

Mesuré le 2026-09-29 dans le navigateur, mode `md`, sombre système, sur la modale
de protection et le sélecteur d'exchange. Seuil WCAG AA pour du petit texte :
**4,5:1**.

| Endroit                                            |     Avant |     Après |
| -------------------------------------------------- | --------: | --------: |
| Fond de `.summary-section` (texte blanc sur carte) |  **1,10** |     14,72 |
| `.chip-short` — le slug de la stratégie            |  **1,47** |      5,32 |
| Action-sheet « choisir un exchange »               |  **1,60** |     12,39 |
| `.strategy-chip`, `.interval-chip`                 |  **2,09** |      5,32 |
| `.atr-dir` — « ↓ below the anchor »                |  **2,54** |      5,25 |
| Bandeau « enabled, but the bot is not running »    | 2,17–2,64 | 3,42–4,29 |

Et deux défauts qui ne se voyaient qu'en **clair** :

| Endroit                                        | Avant                              | Après                             |
| ---------------------------------------------- | ---------------------------------- | --------------------------------- |
| Bordure de `.summary-section` et `.entry-card` | `0px none` — invisible             | `0.67px solid rgb(232, 232, 232)` |
| Fond du rule-tree                              | `rgb(28, 28, 28)` sur page blanche | `rgb(232, 232, 232)`              |

La méthode pour les colonnes « avant » : les valeurs de l'ancien thème sont
reposées **en style en ligne** sur `documentElement` et sur les éléments visés,
puis retirées. Une injection par feuille de style ne suffit pas — elle perd les
combats de spécificité contre `:root:not(.dark-theme):not(.light-theme)` et
rend des chiffres faux. Recoupement : la reconstitution retrouve à l'identique
les 1,10 et 2,09 relevés en début de séance, avant toute modification.

## Quatre pièges de couleur, et ce qu'ils ont coûté

### Le `shade` d'Ionic va dans le mauvais sens en thème sombre

Ionic peint le texte d'une `ion-chip` colorée avec `--ion-color-shade`. Assombrir
**éloigne** du fond quand le fond est clair, et l'en **rapproche** quand il est
sombre : le défaut travaille donc contre la lisibilité dans un thème sombre.

Mesuré le 2026-09-29 sur les six couleurs × les deux remplissages, avec de
vraies `ion-chip` hydratées (contraste avec `--ion-color-shade` → avec
`--ion-color-base`) :

| Puce             | Sombre          | Clair         |
| ---------------- | --------------- | ------------- |
| `medium` plein   | 4,22 → **5,32** | 6,76 → 5,70   |
| `medium` outline | 4,76 → 6,00     | 7,56 → 6,37   |
| `primary` plein  | 4,68 → 5,99     | 14,27 → 13,55 |
| `danger` plein   | 3,50 → 4,39     | 6,50 → 5,35   |
| `danger` outline | 3,80 → **4,78** | 7,53 → 6,20   |
| `success` plein  | 5,79 → 7,51     | 2,38 → 1,83   |
| `warning` plein  | 7,26 → 9,49     | 2,00 → 1,53   |
| `tertiary` plein | 4,68 → 5,98     | 2,97 → 2,32   |

La base gagne **partout** en sombre (+0,89 à +2,66 ; en gras, les deux qui
repassent au-dessus de 4,5:1) et perd **partout** en clair (−0,47 à −1,33).
Aucune combinaison ne franchit le seuil vers le bas en clair, mais dégrader un
thème sain pour en réparer un autre n'a pas de sens : la règle est posée dans
`src/styles.scss`, **en sombre seulement**, via `when-dark`.

Le même travers touche `.stalled__why`, la ligne d'explication d'un bandeau
d'alerte, qui se distingue de son titre en prenant `--ion-color-danger-shade` :
6,26:1 en clair — la nuance y est gratuite — mais 4,16:1 en sombre. Elle prend
donc la couleur du titre en sombre, la hiérarchie reposant alors sur la
typographie seule (700, majuscules, interlettré). Même règle, même endroit, et
elle couvre d'un coup les deux composants qui recopient ce bandeau.

Un `shade` n'est pas condamné pour autant : celui de `warning` (`#e0b52b`) tient
6,56:1 en sombre. C'est la marge de la couleur qui décide, pas le principe.

### Une `opacity` ne remplace pas un rôle

Atténuer avec `opacity` un texte qui porte **déjà** une couleur secondaire
multiplie deux atténuations. `--ion-color-medium` à 60 % sur une carte sombre
tombait à 2,83:1. La taille et le poids hiérarchisent ; l'opacité, sur du texte,
ne fait que le rendre illisible.

Les contrôles **désactivés** font exception : Ionic les passe à `opacity: .5` et
la WCAG (1.4.3) exempte explicitement les composants inactifs. Les boutons
« Add TP » / « Add SL » à 2,68:1 en sont, ce n'est pas un défaut.

### Une chaîne `var()` doit finir sur une variable définie

```scss
/* ✗ */
border: 1px solid var(--ion-border-color, var(--ion-color-step-100));
/* ✗ */
background: var(--ion-color-step-100, #1c1c1c);
/* ✓ */
border: 1px solid var(--ion-border-color, var(--ion-background-color-step-100));
```

`--ion-color-step-*` est l'**ancienne** échelle unifiée d'Ionic, remplacée par le
couple `--ion-background-color-step-*` / `--ion-text-color-step-*`. Ce thème ne
la définit pas, et Ionic lui-même ne l'écrit que comme point de surcharge — ses
propres feuilles s'écrivent `var(--ion-color-step-N, var(--ion-…-step-N))`. La
garder en tête de chaîne est donc juste ; s'arrêter là ne l'est pas.

Les deux conséquences observées : une bordure qui disparaissait en clair (la
déclaration devenait invalide, `0px none`), et un fond de rule-tree figé à
`#1c1c1c` dans **les deux** thèmes — noir sur page blanche en clair, et à une
unité du fond en sombre.

### Un fond teinté de la couleur de son propre texte

L'app écrit partout le même idiome, recopié dans **quatre fichiers** :

```scss
border: 1px solid var(--ion-color-danger);
background: rgba(var(--ion-color-danger-rgb), 0.1);
color: var(--ion-color-danger);
```

Le fond monte alors **vers** le texte, et le contraste se referme d'autant.
Ionic fait pareil sur ses puces colorées (`rgba(base, .08)`). Ce n'est pas une
erreur en soi — c'est une teinte discrète qui rattache le bloc à son sens — mais
elle mange une réserve de contraste que le rouge sombre d'Ionic n'avait pas.

Trois pistes mesurées le 2026-09-29, en sombre :

|                     | actuel | sans la teinte | `#f35e69` | **`#ff6b75`** |
| ------------------- | -----: | -------------: | --------: | ------------: |
| titre du bandeau    |   4,29 |           4,78 |      4,69 |      **5,31** |
| ligne « pourquoi »  |   3,42 |           3,80 |      3,36 |      **5,31** |
| `.type-chip` danger |   3,84 |           3,84 |      4,21 |      **4,77** |
| `.alloc-label` SL   |   4,18 |           4,18 |      4,64 |      **5,34** |

Retirer la teinte ne suffit pas : ça ne touche ni `.alloc-label`, qui n'en a
pas, ni la puce — Ionic écrit son fond **en dur**, `--background` ne le reprend
pas. C'est donc la couleur qui monte, dans `dark-mode-vars` seulement :
`--ion-color-danger: #ff6b75`. Valeur dérivée, pas une valeur d'Ionic — le
premier cran qui fait passer les quatre cas. Le noir de `contrast` y gagne
aussi, 5,95 → 7,61:1, et aucune feuille n'écrit de blanc sur un fond `danger`.

Balayage complet après coup : **7 échecs → 2**, les deux restants étant les
non-défauts connus (`.save-btn`, artefact de sonde ; `.add-btn`, désactivé).
Aucun nouvel échec, aucun aggravé. Vérifié aussi sur `user-fills` (bandeau de
perte, 4,29 → 5,31) et `trading-pair-modal` (bandeau, 3,42/4,29 → 5,31 ; plus
aucun échec dans la modale). La variante `--warning` du même bandeau garde son
`warning-shade` : `#e0b52b` tient 6,56:1, le jaune est assez clair pour que la
mauvaise direction ne coûte rien.

## Ce qui reste

- **`danger` plein reste à 4,39:1 en sombre** sur une puce — la seule des douze
  combinaisons à rester sous le seuil.
- **Le vert de succès en thème clair** : `#2dd55b` sur blanc donne 1,68:1. C'est
  la valeur par défaut d'Ionic, jamais reprise par l'app, et elle est illisible
  en clair pour du texte. Non corrigée : changer une couleur de marque est une
  décision, pas un correctif.
- **`--ion-text-color-step-400`** (`#777777`) sert du texte d'explication à
  4,06–4,47:1 en clair. Juste sous le seuil.
- **Encore des `opacity` sur du texte, en clair** : `ion-badge` est passé à 0,75
  globalement (`.prot-badge` tombe à 3,84:1 sur son fond rouge) et `.select-text`
  à 0,6 (4,45:1). Même travers que celui décrit plus haut, pas encore traité.
- Deux feuilles dépassent le budget de 4 kB d'Angular
  (`protective-modal.component.scss`, `watchlist-detail.page.scss`). Le
  dépassement **préexistait** — 4581 et 4922 octets compilés compressés à
  `076768f` — et n'a pas été traité ici.

## Mesurer soi-même

Le contraste ne s'apprécie pas à l'œil : il se calcule. Dans la console du
navigateur, une sonde qui compose le fond réel (en remontant les parents
transparents) et tient compte des `opacity` empilées suffit — c'est ce qui a
produit tous les chiffres de cette page. Deux erreurs à éviter, toutes deux
commises ici avant d'être corrigées :

- **oublier l'`opacity`** : `getComputedStyle(el).color` ne la reflète pas. Un
  texte annoncé à 5,39:1 en valait 2,87 à l'écran ;
- **croire un élément replié** : un titre dans un menu fermé mesure 0 × 0 et se
  compare alors au fond de la page, pas au sien. Vérifier `getBoundingClientRect`
  avant de conclure — un « 1,25:1 » s'est révélé être du noir sur `#4db5a5`,
  c'est-à-dire 8,47:1.

Même remarque pour le texte d'un bouton Ionic : il vit dans le shadow DOM
(`.button-native`), et lire l'hôte donne une couleur qui n'est pas celle qui est
peinte.
