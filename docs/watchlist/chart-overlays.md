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

# Le rapport de backtest

Sous le chart, le bouton « Backtest » ouvre un bloc compact par stratégie visible ; toucher
un bloc ouvre le rapport détaillé (`BacktestReportModalComponent`) : chiffres par côté, courbe
de performance, positions ouvertes, positions héritées, liste des trades.

**L'app ne calcule rien.** Le rapport est `AnalysisResponse.strategies[].report`, produit par
`buildBacktestReport` (trading-shared-types) **dans le bot**, sur la fenêtre demandée.
`watchlist/utils/backtest-display.util.ts` ne fait que choisir quoi montrer et arrondir pour
l'affichage — un chiffre recalculé ici pourrait diverger du bot en silence, un chiffre
arrondi ne le peut pas.

Ce que le rapport garantit, et que l'écran respecte :

- **la fenêtre affichée, rien d'autre** — un trade ouvert dans l'amorçage n'est pas
  compté ; une position ouverte avant la fenêtre et encore ouverte à son début est listée à
  part (« carried in ») et n'entre dans aucun chiffre ;
- **aucun arrondi au calcul** — rendement de chaque trade recalculé depuis les prix ;
- **taille constante, rendements additionnés** — ni levier, ni réinvestissement ;
- **courbe et drawdown à chaque bougie, pertes latentes comprises** — un trade descendu à
  −8 % puis refermé à +1 % a bien exposé à −8 % ;
- **pas de total quand long et short se chevauchent** — le rapport renvoie `total: null`,
  le bloc et la modale disent pourquoi (le bot ne tient qu'une position par paire), et
  aucune somme n'est tracée. Sur le chart, **la bande de positions colore ces bougies en
  ambre** (`POSITION_COLORS.overlap`, la couleur d'avertissement d'Ionic), avec la même règle
  que le rapport : la bougie de sortie ne compte pas, un retournement sur une même bougie
  n'est donc pas un chevauchement. Vérifié : 4 bougies ambre dans la fenêtre pour 4
  bougies de chevauchement rapportées, même première bougie. La bande dessine aussi
  l'amorçage, où un chevauchement peut apparaître en ambre sans être compté par le
  rapport — c'est la fenêtre qui décide des chiffres, pas du dessin ;
- **les anomalies de timeline sont listées**, jamais corrigées en silence.

Les côtés affichés sont ceux que la stratégie définit (`definedSides`) : « Short 0 trade »
sur une stratégie purement longue laisserait croire à un côté qui ne produit rien.

**Toucher un trade** referme la modale et recentre le chart principal dessus
(`tradeFocusRange` : la moitié de la durée du trade de chaque côté, au moins dix bougies),
là où ses bougies, ses marqueurs et sa bande de position se lisent ensemble. La plage peut
remonter dans l'amorçage pour une position héritée : ces bougies sont dessinées, seulement
hors de la fenêtre par défaut.

La courbe vit dans un petit chart à part (`EquityCurveComponent`), pas dans un pane du chart
principal, dont la hauteur est déjà rationnée. Son dernier point est signalé provisoire
quand il tombe sur la bougie en cours.

**La référence à battre est tracée avec la stratégie** (types partagés 0.33.0) : une
quatrième courbe, grise et pointillée, l'achat-conservation sur la même fenêtre. « Ne rien
faire » est ce qu'une stratégie doit dépasser pour exister, et une courbe qui monte seule à
l'écran se lit comme un succès même quand le cours qu'elle suit a fait mieux. Elle vient de
`equity[].hold` : l'app ne la calcule pas, comme le reste.

Le tableau porte `Buy and hold` juste sous `Realized, net of fees` — **une seule valeur
étalée sur les colonnes**, parce que la référence n'a pas de côté. ⚠️ Et non une colonne de
plus : mesuré à 360 px, le tableau occupe 328 px avec trois colonnes de valeurs déjà à leur
largeur minimale ; une quatrième déborderait ou écraserait les libellés. Vérifié à 360 et
411 px, les onze lignes tiennent chacune sur une seule.

Deux lignes l'accompagnent : `Time in position` (l'union des deux côtés, héritées comprises)
et `Payoff ratio` (par côté, `—` quand un des deux manque). Le bandeau, lui, porte l'écart :
`-0.88% vs hold`, en **points** parce que les deux chiffres comparés sont déjà des
pourcentages.

⚠️ **Le hold est brut de frais**, comme chez TradingView (« Buy & hold return ») et
Freqtrade (`market_change`). L'écart avantage la référence, donc désavantage la stratégie :
une asymétrie conservatrice, que la note des limites chiffre (`0.09%` d'aller-retour épargné
au palier de base) plutôt que de la taire.

**Trois lectures d'un même creux**, dans le tableau, parce qu'un seul chiffre ne répond pas
à trois questions (types partagés 0.31.0) :

| ligne                    | ce qu'elle répond                                                |
| ------------------------ | ---------------------------------------------------------------- |
| `Max drawdown, net`      | le pire creux traversé, sur les clôtures                         |
| `Max drawdown, intrabar` | le même, au pire instant de chaque bougie — jamais moins profond |
| `Below its peak now`     | le recul où le compte est **encore**, à la dernière clôture      |

TradingView publie les deux premières côte à côte, Freqtrade la troisième (« Current
drawdown »). ⚠️ L'intra-bougie est une **borne inférieure** et la note des limites le dit :
son sommet est lu sur les clôtures, parce qu'apparier un plus haut et un plus bas dans une
même bougie supposerait un ordre que l'OHLC ne donne pas.

⚠️ Le « jamais moins profond » de la deuxième ligne a été **faux à l'écran** : les types
partagés 0.31.0 lisaient le sommet sur la courbe adverse, et une mèche sous la bougie du
sommet l'abaissait autant que le creux. Mesuré sur BTC le 2026-10-14, cette page affichait
`-2.41%` d'intra-bougie sous un `-2.86%` de close-to-close. Corrigé en 0.31.1 ; la leçon
tient en une ligne : une courbe partout plus basse ne donne pas un drawdown plus profond.

**Sous la courbe, le « quand »** : « When the max drawdown happened » date le sommet et le
creux de chaque colonne et donne la durée entre les deux (`drawdownWindow`,
`formatDuration`). La profondeur seule ne permet pas de décider — 12 % perdus en trois
heures et les mêmes 12 % perdus en trois mois ne disent pas la même chose d'une stratégie —
et c'est bien cette durée que Freqtrade (« Drawdown start / end / duration ») comme
TradingView (« max drawdown duration ») publient à côté du chiffre. Le bandeau compact, lui,
n'a la place que pour la durée : `DD -12.34% over 2 d 12 h`.

**Puis « Still under water »** (`underwaterWindow`) : depuis quel sommet, et depuis combien
de temps, pour les seules colonnes encore en dessous. Sans pourcentage — le tableau le porte
déjà, et le même chiffre à deux endroits fait chercher une différence qui n'existe pas.
Quand plus personne n'est sous l'eau, la section l'**écrit** au lieu de disparaître : une
section absente se lit comme une donnée manquante, alors que c'est une bonne nouvelle.

Deux formulations valent une explication :

- **« Range start »** au lieu d'une date — le sommet est planché au capital intact depuis
  les types partagés 0.30.0, donc `peakTime` vaut `null` quand la courbe n'est jamais
  remontée à ce capital. Ce n'est pas une absence de sommet : c'est un sommet qu'aucune
  bougie n'a touché, et l'écran y substitue le début de la fenêtre plutôt que de dater la
  baisse de 1970 ;
- **« within one candle »** au lieu d'une durée — sommet et creux au même instant. Le cas
  courant est une position ouverte sur la première bougie de la fenêtre, dont le frais
  d'entrée fait passer la courbe sous le capital intact avant tout autre point.

## Ce que le backtest ne dit pas

Le rapport vient de `POST /analysis`, qui fait tourner le **même** moteur que le bot en live
(`StrategyEngineService.execute`). Les signaux sont donc bien ceux que le bot produirait sur
ces bougies. La simulation s'écarte pourtant du live sur plusieurs points, écrits sous les
chiffres (`BACKTEST_LIMITS`) parce qu'ils se lisent sinon comme « ce que la stratégie
aurait rapporté » :

| Écart                                                            | D'où il vient                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| trades au prix de clôture de la bougie du signal                 | le moteur ; un live ne peut pas traiter à une clôture déjà vue |
| ni funding, ni slippage                                          | la simulation ; les **frais**, eux, sont comptés depuis 0.27.0 |
| TP/SL (`protective`), ordres latents, `exitBehavior` non simulés | `/analysis` ne reçoit que les règles                           |
| taille constante, rendements additionnés                         | le rapport ; ni levier ni réinvestissement                     |

Les deux écarts que corrigeait l'étape B — trades de l'amorçage comptés, long et short
additionnés alors que le bot ne peut pas tenir les deux — sont traités par le rapport
lui-même. Le prix d'exécution relève de l'étape 3 côté bot (voir le
[roadmap](../roadmap.md#rendre-la-simulation-digne-de-confiance)).

## Un signal sur la bougie en cours est provisoire

La dernière bougie reçue n'est généralement pas close : son `close` est le dernier prix
échangé. Une condition vraie à cet instant peut ne plus l'être dix minutes plus tard, et
le marqueur disparaître au rafraîchissement suivant — sans rien pour le distinguer d'un
signal acquis.

`forming-candle.util.ts` le détecte (une bougie ouverte à `t` est close dès que
`now ≥ t + intervalle`) et la page nomme, sous la bande de puces, les stratégies qui ont un
signal dessus. Le jugement est figé au retour de la réponse : si la bougie se ferme pendant
que la page reste ouverte, l'avertissement persiste jusqu'au rechargement suivant, ce qui
pèche du côté sûr.

⚠️ `now` est l'horloge de l'appareil. En avance, elle ferait juger close une bougie qui ne
l'est pas, et tairait l'avertissement. `AnalysisCandle` ne porte pas d'heure de clôture
servie par le bot qui permettrait de s'en passer.

Le défaut de fond est côté bot, qui décide lui aussi sur cette bougie — voir
[roadmap.md](../roadmap.md#le-bot-décide-sur-une-bougie-qui-nest-pas-close).

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
d'accuser le réseau. La décision vit dans `overlay-failure.util.ts`, à part et testée : un
`5xx` ou une absence de réponse ne sont pas des refus, il n'y a rien à corriger dans la
requête.

C'est ce qui couvre les cas que la prévention laisse passer **volontairement**, et il y en
a deux — la même raison de part et d'autre. Un indicateur inconnu de ce build part dans
une expression, parce que le bot le connaît peut-être ; et une stratégie qui le contient
passe `isLocallyExecutable` pour la même raison, donc part aussi dans `strategies[]` où
`assertStrategiesAreUnambiguous` la refusera. Dans les deux cas le client a eu raison de
ne pas trancher, et le message dit ce qui s'est passé.

## Trois intervalles que le backtest ne sait pas lire

**8H, 12H et 3D sont de vraies bougies d'Hyperliquid** — mesuré le 2026-10-14 sur le
gateway : 8 h exactement, grille alignée sur 00:00 / 08:00 / 16:00 UTC pour la première, 3
jours exactement pour la dernière. Mais `ChartInterval`, le jeu de codes que `POST /analysis`
accepte, n'en porte aucune : c'est une liste de fournisseur de chart, qui contient au
passage cinq codes qu'Hyperliquid ne sert pas (`'2'`, `'10'`, `'45'`, `'180'`, `'3M'`).

⚠️ `toChartInterval` rabattait ces trois-là sur `'60'` — **une heure** — avec un
`console.warn` pour seule trace. Mesuré dans le navigateur : sélectionner 8H affichait 253
bougies d'une heure **et le backtest d'une heure avec**, sous une étiquette 8H. Le pire des
cas sur un écran qui sert à décider, et il dépendait de ce qui était attaché : sans
stratégie ni indicateur, le même bouton affichait les vraies bougies 8h, puisque ce
chemin-là (`fetchViaCandles`) ne passe pas par l'analyse.

Depuis, `chartIntervalFor` rend `null` au lieu d'un intervalle inventé, et la page
court-circuite l'analyse : vraies bougies, aucune surcouche, et le toast le dit — « Chart
loaded without indicators — the bot cannot analyse 8H candles. » Le cache des résultats est
vidé au passage, donc aucun bilan d'un autre intervalle ne survit sous ces bougies.

Lever la limite demanderait d'étendre `ChartInterval` (`'480' | '720' | '3D'`) dans les types
partagés, le mapper du bot et cette table. Ça ne donnerait que le **backtest** : le bot
n'automatise que `'15' | '60' | '240' | '1D'` (`PASS_SCHEDULES`), et la configuration des
paires ne propose que ces quatre-là, lus du catalogue serveur.

## Un refus est un état, pas un événement

Il reste vrai tant que la configuration ne change pas, alors qu'un toast est fait pour un
événement. Sans précaution, chaque rechargement — un changement d'intervalle, un retour au
premier plan — en empilait un de plus : trois toasts de 6 s présentés à la suite se lisent
comme un seul qui ne part jamais, et finissent par masquer l'app. Ils survivaient même à la
navigation, un message sur le chart de BTC restant affiché par-dessus la watchlist.

Le motif n'est donc annoncé qu'**une fois par occurrence** : un motif identique ne se
réannonce pas, un succès réarme l'annonce, un seul toast existe à la fois, et il est
refermé en quittant la page. Mesuré : un toast de 0 à 6 s, trois rechargements sans
nouvelle annonce, puis une annonce de nouveau après un chargement réussi.

---

# Le canvas séparé

Les ordres et les exécutions de l'utilisateur ne sont pas des séries : ils sont dessinés
à la main sur un `<canvas>` posé au-dessus du chart, en convertissant les coordonnées avec
`timeScale().timeToCoordinate()` et `series.priceToCoordinate()`.

La conséquence pratique est qu'il faut **le redessiner soi-même** à chaque changement de
plage visible (`subscribeVisibleLogicalRangeChange`), contrairement à une série que la
librairie repositionne seule. `scheduleOverlayDraw()` passe par `requestAnimationFrame`
pour ne pas redessiner plusieurs fois dans la même frame.
