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

## Deux pièges de couleur, et ce qu'ils ont coûté

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

## Ce qui reste

- **Les puces colorées d'Ionic utilisent `--ion-color-shade` pour leur texte.**
  Assombrir est juste sur fond clair, à l'envers sur fond sombre. Mesuré :
  `medium-shade` donne 4,22:1, la couleur de base 5,32:1. Seules les puces de la
  modale de protection sont corrigées, là où l'illisibilité a été constatée ; la
  règle générale reste à trancher (une ligne dans `global.scss` suffirait).
- **Rouge sur rouge.** `.type-chip` en `danger` tient 3,84:1 et
  `.alloc-label.sl-label` 4,18:1 — le fond de ces éléments est teinté avec la
  couleur du texte, ce qui rapproche les deux. Sous le seuil, mais très au-dessus
  des 1,98 et 2,17 d'avant.
- **Le vert de succès en thème clair** : `#2dd55b` sur blanc donne 1,68:1. C'est
  la valeur par défaut d'Ionic, jamais reprise par l'app, et elle est illisible
  en clair pour du texte. Non corrigée : changer une couleur de marque est une
  décision, pas un correctif.
- **`--ion-text-color-step-400`** (`#777777`) sert du texte d'explication à
  4,06–4,47:1 en clair. Juste sous le seuil.
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
