# Chart Overlays

## Purpose

Le chart de la watchlist (`features/secure/watchlist/pages/watchlist-detail`) empile sept
couches sur une même échelle de temps. Elles n'ont ni le même propriétaire, ni le même
cycle de vie, ni la même façon d'être redessinées — et plusieurs des règles qui les
gouvernent ne se déduisent pas du code : elles ont été apprises en cassant quelque chose.

Ce document existe pour éviter de les réapprendre.

---

# Les couches

| Couche               | Propriétaire                    | Où                         |
| -------------------- | ------------------------------- | -------------------------- |
| Bougies              | la page                         | pane 0                     |
| Volume               | la page                         | pane 0, échelle dédiée     |
| Indicateurs          | `IndicatorOverlayService`       | pane 0 ou pane dédié       |
| Expressions          | `ExpressionsPaneService`        | pane 0 ou pane par échelle |
| Marqueurs de signal  | `StrategySignalsOverlayService` | sur la série de bougies    |
| Bande de positions   | `StrategyPositionsPaneService`  | pane dédié, index 1        |
| Ordres et exécutions | la page (`drawOverlay`)         | canvas séparé              |

Le volume vit sur le pane des bougies mais avec sa propre échelle (`priceScaleId: 'volume'`,
`scaleMargins: { top: 0.8 }`), ce qui le tasse en bas sans toucher à l'échelle des prix.

---

# Les règles de pane de lightweight-charts

Quatre comportements de la librairie, tous contre-intuitifs, tous rencontrés en
production.

## Un pane se supprime tout seul

Retirer la dernière série d'un pane **détruit le pane**. C'est
`_cleanupIfPaneIsEmpty`, et ce n'est désactivable qu'à la création :
`chart.addPane(true)` (`preserveEmptyPane`).

Conséquence directe : la séquence « je retire mes séries, puis je retire mon pane » est
un bug. Au moment du `removePane`, le pane n'existe déjà plus, l'index est périmé, et
l'assertion `Invalid pane index` **interrompt le rendu en cours** — le chart reste à
moitié dessiné, et le symptôme observé n'a rien à voir avec la cause (une bande qui ne
revient jamais après un toggle).

Les deux services à pane créent donc avec `preserveEmptyPane` et vérifient l'attache
avant de retirer :

```ts
const index = this.chart.panes().indexOf(pane);
if (index >= 0) this.chart.removePane(index);
```

## Un index de pane mis en cache devient faux

Corollaire du point précédent : quand un pane disparaît, les suivants se décalent. Un
`paneIndex` stocké au moment de créer une série pointe alors ailleurs.

`IndicatorOverlayService` documentait déjà le piège et le contournait en redemandant la
position à une série vivante (`series.getPane().paneIndex()`). Les deux services plus
récents ne l'avaient pas repris — d'où le bug ci-dessus. **Garder la référence au pane,
jamais son index.**

## `addPane` ajoute toujours à la fin

Il n'y a pas de « créer à la position N ». Un pane masqué puis réaffiché réapparaît donc
sous tout ce qui a été créé entre-temps, et l'ordre du chart dépend de l'historique des
toggles plutôt que d'une intention.

`pane.moveTo(index)` corrige après coup. La bande de positions se place ainsi en 1,
juste sous les bougies, quel que soit l'ordre de création.

## Les hauteurs sont des facteurs, pas des pixels

`pane.setHeight(px)` **ne tient pas**. Les panes se partagent une hauteur totale fixe, et
la répartition écrase la valeur proposée à la mise en page suivante. Le seul levier réel
est `pane.setStretchFactor(f)`, relatif : lire celui du pane 0 et exprimer les autres par
rapport à lui.

Et la hauteur totale, elle, ne vient pas du CSS qu'on croit : le `ResizeObserver` observe
`.chart-container`, qui n'a pas de hauteur propre — c'est le chart qui la lui donne.
Agrandir `.chart-wrapper` ne change donc rien au total ; cela ne fait que redistribuer.

---

# Où va une courbe : sur les bougies ou dans un pane

La question n'est pas esthétique. `EMA(9)` et `(EMA(20) + ATR(14))` sont des niveaux de
prix : les tracer ailleurs que sur les bougies cache la seule chose qu'on veut voir, leur
position par rapport au cours. `zscore(close, 200)` tient entre -3 et +3 ; posé sur des
bougies à 77 000 $, c'est une ligne plate collée au bas du graphe.

**Pour un indicateur**, la réponse est dans le catalogue : `IndicatorMetadata.overlay`.

**Pour une expression** (un opérande de règle, qui peut être composé), c'est
`strategies/domain/operand-scale.util.ts` qui tranche, à partir du même catalogue :
`overlay` pour un indicateur, `TransformMetadata.outputScale` pour une transformation.
Deux conventions y sont écrites :

- un prix plus une volatilité reste un prix (`SMA(20) + ATR(14)` est une bande) ;
- un prix divisé par un prix est un rapport sans unité.

Une constante est _neutre_ : elle n'a pas d'unité propre et hérite de l'échelle de ce que
sa condition lui compare. `2` face à un z-score va dans le pane du z-score ; `100000`
face à `close` va sur les bougies.

Ce que ce build ne reconnaît pas obtient **son propre pane**. Le choix est asymétrique et
délibéré : se tromper vers le pane coûte un peu de hauteur, se tromper vers l'échelle des
prix écrase les bougies.

Les expressions non-prix sont groupées par échelle, un pane par groupe — un z-score et un
percentile ne partagent jamais un axe.

---

# Valeurs indéterminées : un trou, pas un trait

Un indicateur classique ne produit rien tant qu'il n'est pas amorcé, puis produit toujours
un nombre. Une transformation glissante, elle, peut **redevenir `null` en plein milieu**
d'une série déjà amorcée : un z-score sur une fenêtre d'écart-type nul n'existe pas.

Filtrer ces points relierait les deux bords du trou par une droite, et cette droite se
lirait comme une valeur. `expression-series.util.ts` émet donc un point _whitespace_ (un
temps sans valeur) : le trait s'interrompt, et l'absence se voit.

Le compte affiché sur la puce ne retient que les trous survenus **après** le premier point
défini. L'amorçage — 199 points vides devant un `zscore` sur 200 bougies — est le
fonctionnement normal d'une fenêtre glissante ; le compter alarmait sur ce qui va bien et
noyait le seul cas qui mérite un regard.

Le rendu des indicateurs, lui, filtre encore les points non numériques. C'est sans
conséquence aujourd'hui (aucun indicateur mono ou multi-ligne ne produit `null` une fois
amorcé) mais le commentaire dans `indicator-overlay.service.ts` le signale : à revoir
explicitement le jour où un indicateur le ferait.

---

# Marqueurs de signal

`buildStrategyMarkers` fusionne les signaux de plusieurs stratégies en un seul jeu, parce
que lightweight-charts n'en accepte qu'un par série **et l'exige trié par temps
croissant** — deux stratégies entrelacées produisent mécaniquement des temps désordonnés.

Un marqueur ne porte que deux informations, et les code deux fois plutôt qu'une :
la **couleur** identifie la stratégie ; la **position et la forme** disent entrée ou
sortie. La redondance est voulue.

Le côté long/short a quitté les marqueurs pour la bande de positions, qui le montre sur
toute la durée plutôt qu'au seul instant du signal. Une version précédente mettait le côté
sur la forme : une flèche haute au-dessus d'une bougie — sortie de short — se lisait de
travers.

Aucun libellé, délibérément. Une version antérieure écrivait « EMA/SMA cross EXIT LONG »
sur chaque marqueur ; sur un téléphone, deux stratégies et une trentaine de signaux
suffisaient à rendre le chart illisible.

---

# Ce qui déclenche un appel réseau

Le patron est le même pour les indicateurs, les stratégies et les expressions :

> **la requête porte tout ce qui est attaché ; la visibilité ne filtre que l'affichage.**

Basculer une puce ne coûte donc aucun aller-retour — les séries sont en cache et
`apply*Visibility()` les redessine. Deux exceptions, toutes deux dans le même sens :

- cocher une expression **nouvelle** déclenche un fetch, puisqu'elle n'a jamais été
  demandée sur cette fenêtre ;
- rendre visible une stratégie **sans résultat en cache** aussi, pour la même raison.

Une stratégie qui ne passe pas `isLocallyExecutable` est attachée mais **pas envoyée**
dans `strategies[]` : le serveur rejetterait la requête d'analyse entière, emportant
aussi les indicateurs.

Ses expressions, en revanche, partent quand même — déboguer une règle que la validation
refuse est précisément le moment où on en a besoin, et l'échec est le plus souvent
structurel (branche vide, côté absent) alors que les opérandes, eux, sont corrects.

## Une expression malformée emportait tout le reste

Le risque a été reproduit, mesuré, et corrigé. `POST /analysis` valide `expressions[]` en
bloc (`assertExpressionsAreValid`) et **rejette la requête entière** si un seul opérande
est incohérent. Une expression fautive faisait donc disparaître les indicateurs du chart,
qui n'y étaient pour rien — et le repli annonçait « the analysis service did not
respond », alors que le service avait répondu en nommant le coupable.

Deux garde-fous, parce qu'aucun des deux ne suffit seul.

**Ne pas envoyer ce qu'on sait malformé.** `isOperandLocallySound` applique la même
partition qu'ailleurs : une valeur _malformée_ (un `number` qui n'en est pas un, un offset
négatif) est un verdict dont ce build est certain, donc l'opérande n'est pas joint à la
requête. Une valeur _non reconnue_ ou dépendante du catalogue part quand même — se taire
là reviendrait à décider à la place du serveur.

L'expression n'est pas escamotée pour autant : elle reste listée, marquée, non cochable,
avec la raison écrite. Une courbe qui manque sans explication serait le défaut qu'on
cherche à éviter, pas sa correction.

**Dire la vérité quand le bot refuse.** Un `4xx` porte un rapport d'anomalies ; le repli
le cite désormais (« the bot refused the request: Unknown indicator … ») au lieu
d'accuser le réseau. C'est ce qui couvre le cas que la prévention laisse passer
volontairement — un indicateur inconnu de ce build mais que le bot refuse aussi.

---

# Le canvas séparé

Les ordres et les exécutions de l'utilisateur ne sont pas des séries : ils sont dessinés
à la main sur un `<canvas>` posé au-dessus du chart, en convertissant les coordonnées avec
`timeScale().timeToCoordinate()` et `series.priceToCoordinate()`.

La conséquence pratique est qu'il faut **le redessiner soi-même** à chaque changement de
plage visible (`subscribeVisibleLogicalRangeChange`), contrairement à une série que la
librairie repositionne seule. `scheduleOverlayDraw()` passe par `requestAnimationFrame`
pour ne pas redessiner plusieurs fois dans la même frame.
