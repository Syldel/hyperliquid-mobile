# Direction et portée

## Purpose

Ce que ce projet a **délibérément remis à plus tard**, et pourquoi. Les autres documents
décrivent ce qui existe ; celui-ci existe pour qu'un manque ne soit pas pris pour un
oubli, et qu'on ne rouvre pas par zèle un sujet qui a déjà été tranché.

Ce ne sont pas des tâches datées, ce sont des décisions de portée. Elles se relisent quand
le contexte change.

---

# L'objectif du moment

**Valider l'architecture actuelle et le fonctionnement du rule-builder** : construire des
conditions à partir d'indicateurs, d'arithmétique, de transformations ; les voir se
comporter sur un chart ; les confier au bot. Tant que cette boucle n'est pas éprouvée, le
reste attend — y compris des chantiers qui paraissent plus structurants.

---

# Prochaines étapes

À distinguer des [limites acceptées](#limites-acceptées) plus bas : ce qui suit est en
attente, pas arbitré.

## Rendre la simulation digne de confiance

Ordre arrêté le 2026-09-17. Un chiffre de backtest se lit spontanément comme « ce que la
stratégie aurait rapporté ». Tant qu'il ne l'est pas, l'import de stratégies écrites par
une IA n'aurait rien de fiable sur quoi les juger. D'où cet ordre, **une étape = un commit
cohérent** :

1. **Fait — A, dire ce que la simulation ne fait pas** (mobile). Limites listées sous le
   bilan, sortie implicite annoncée dans le builder, signal sur la bougie en cours marqué
   provisoire. Voir
   [watchlist/chart-overlays.md](watchlist/chart-overlays.md#ce-que-le-backtest-ne-dit-pas).
2. **Fait — étape 0, mesurer la bougie en cours** (nest-trading-bot, sans rien changer au
   live). Rejeu cycle par cycle, bougie en cours comprise, comparé à une décision par bougie
   close : `docs/trading/forming-candle-replay.md` dans nest-trading-bot, résumé dans les
   [risques identifiés](#risques-identifiés).
3. **Fait — B, le rapport de simulation**, en rupture coordonnée sur les trois dépôts.
   `TimelineSignal` est typé strictement (`side`, `price`) ; `buildBacktestReport`
   (trading-shared-types) remplace le `summary` et tourne **dans le bot**, sur la fenêtre
   demandée ; l'app affiche un bloc compact et un rapport détaillé (côtés, courbe à chaque
   bougie, drawdown, trades cliquables qui recentrent le chart), sans rien recalculer. Voir
   [watchlist/chart-overlays.md](watchlist/chart-overlays.md#le-rapport-de-backtest).
4. **Étapes 1 à 3 côté bot**, chacune annoncée avant d'être commencée : décider sur des
   bougies closes uniquement, traiter chaque bougie une seule fois — avec une marge après
   la clôture, une bougie n'étant pas définitive à l'instant où elle se ferme —, et simuler
   au même prix que celui que le live peut réellement obtenir. Deux points à embarquer, pas
   à redécouvrir :
   - **la même fenêtre, bougie en cours comprise, sert aussi à l'ATR et aux conditions des
     ordres latents et protecteurs (TP/SL)** (`calculateMarketMetrics`,
     `HlProtectionService`). Ne corriger que les signaux d'entrée et de sortie laisserait
     les protections décider sur une bougie inachevée ;
   - **`waitSeconds(200)` attend 200 millisecondes, malgré son nom** (`TradingService` et
     `UtilsService`). Tous les appels actuels passent bien des millisecondes, donc aucun
     délai n'est faux aujourd'hui ; mais la cadence est précisément ce que l'étape 2 touche,
     et un nom qui ment y est un piège. À renommer à cette occasion.
5. **C — import / export JSON**, détaillé plus bas. Au-delà de la sauvegarde, il ouvre
   l'écriture assistée de stratégies.

## Plus tard : simuler `latent` et `protective`

Le backtest n'évalue que les règles d'entrée et de sortie. Les ordres latents, les
take-profit / stop-loss et le `exitBehavior` d'une paire ne sont **pas simulés**, alors que
le bot les applique : une paire protégée ne rapporte donc pas ce que le bilan affiche.
C'est dit à l'écran. Les simuler est une évolution à étudier — elle exige de savoir ce qui
se passe à l'intérieur d'une bougie (un stop touché avant ou après le take-profit ?), ce
qu'aucune bougie seule ne dit.

## Traité récemment

**Fait** — les paires héritées sans `shortname` sont désormais signalées dans la liste et
dans le formulaire, et le moteur du bot ne les écarte plus en silence. Voir
[strategies/overview.md](strategies/overview.md#limites-connues).

**Fait** — le catalogue se lit par exchange. `resolveEditedStrategy` cherchait dans
`Object.values(meta.strategies).flat()` ; le report tenait à ce que le bot ne déclare
qu'un exchange, donc que rien ne pouvait diverger. Le traiter a montré que le défaut
s'était dédoublé, et que l'une de ses variantes était **déjà active** :

- la résolution comparait en `===` strict quand le statut comparait sur
  `toLowerCase().trim()`, comme le moteur. Une paire que le bot exécute grâce à cette
  tolérance était jugée saine _et_ laissait le sélecteur vide, sans une ligne pour le
  dire ;
- le sélecteur repliait sur le catalogue aplati quand `meta.strategies[exchangeKey]`
  manquait, et changer d'exchange ne vidait pas la stratégie déjà choisie — deux façons
  d'enregistrer un `shortname` que le bot n'aiguille pas sur cet exchange.

Les trois règles ont été ramenées à une seule,
`bot-strategies/domain/exchange-catalogue.util.ts`, qui nomme quatre situations plutôt
que de replier sur une valeur commode. Le repli annoncé au report n'existe donc plus :
**un exchange sans stratégie déclarée se dit à l'écran** au lieu d'emprunter la liste
d'un autre. Voir
[strategies/overview.md](strategies/overview.md#une-stratégie-appartient-à-un-exchange).

---

# Décidé : la bibliothèque reste locale

La bibliothèque de stratégies vit en stockage local, partitionnée par wallet. Elle ne
survit donc pas à une réinstallation de l'application ni à un changement d'appareil.

**C'est assumé pour l'instant.** L'utilisateur est aujourd'hui seul sur cette application ;
garder les stratégies sur son téléphone n'est pas un problème réel, sauf réinstallation.
En faire un sujet maintenant reviendrait à figer une persistance avant d'avoir validé ce
qu'on y range.

Ne pas construire de bibliothèque persistante côté serveur sans une décision explicite.

## L'étape suivante : import / export JSON

La réponse immédiate au risque de perte, et elle apporte plus que de la sauvegarde.

Le vrai gain visé est un **circuit d'écriture assistée** : une IA qui connaît ce projet,
ses indicateurs et les constructions logiques qu'il autorise produit directement des
stratégies en JSON, que l'utilisateur n'a plus qu'à importer, tester dans
`watchlist-detail`, puis activer comme vraie stratégie via le bot.

```
IA → JSON  →  import  →  watchlist-detail (backtest, expressions)  →  paire du bot
```

C'est aujourd'hui le chemin le plus court entre une idée de stratégie et son évaluation,
et il vaut mieux qu'une bibliothèque partagée tant qu'il n'y a qu'un utilisateur.

### Produire une stratégie exploitable

Le format est un `StrategyDocument` (voir
[strategies/overview.md](strategies/overview.md)), dont `rules` est **exactement**
`StrategyRules` du paquet partagé — aucune conversion, aucun format intermédiaire. Les
contraintes à respecter sont dans [strategies/rule-model.md](strategies/rule-model.md) ;
les deux qui se ratent le plus souvent :

- **écrire les paramètres d'un indicateur explicitement**, même à leur valeur par défaut,
  sinon la stratégie changera de sens le jour où les défauts du bot bougeront ;
- ne pas dépasser la profondeur d'imbrication acceptée pour les opérandes composés.

Ce qui est produit doit être **validé par le bot avant d'être remis** :
`POST /exchanges/strategies/validate` répond `200` avec un rapport d'anomalies. Livrer un
JSON non validé contredirait l'exigence du projet — c'est exactement le genre
d'approximation qui se paie plus tard.

Tant que l'import n'existe pas dans l'interface, le chemin praticable est d'écrire le
document dans `CapacitorStorage.strategy_library`, sous la clé du wallet courant.

### Questions ouvertes sur ce format

À trancher au moment de le construire, pas avant :

- un fichier = une stratégie, ou un lot ?
- à l'import, conserver l'`id` du document (au risque d'écraser une stratégie existante)
  ou en régénérer un ?
- que faire d'un document dont le `schemaVersion` dépasse celui du build qui l'importe ?

## Plus tard : une bibliothèque persistante

Le jour où plusieurs appareils ou plusieurs utilisateurs entrent en jeu. Cela passera par
le service utilisateur, et demandera de décider à qui appartient une stratégie — à
l'appareil ou au compte. Ce n'est pas un chantier de code, c'est une décision d'abord.

---

# Limites acceptées

Connues, mesurées, et laissées telles quelles parce que les corriger coûterait plus que ce
qu'elles gênent.

**La bande de positions se tasse quand trois panneaux coexistent** (~45 px). Les panneaux
se partagent une hauteur totale fixe, et cette hauteur ne vient pas du CSS qu'on croit —
voir [watchlist/chart-overlays.md](watchlist/chart-overlays.md#les-hauteurs-sont-des-facteurs-pas-des-pixels).
La corriger vraiment veut dire changer la façon dont le chart est dimensionné.

**Le placement d'une expression ne se surcharge pas à la main.** L'heuristique vient du
catalogue et se trompe rarement ; ce que ce build ne reconnaît pas obtient son propre
panneau. Un réglage par expression serait l'échappatoire, s'il manque un jour.

---

# Risques identifiés

Ce qui n'a pas pu être vérifié est écrit plutôt que laissé dormir. Chaque `⚠️` des docs
désigne un risque et l'endroit où chercher s'il se manifeste.

## Le bot décide sur une bougie qui n'est pas close

**⚠️ Ouvert.** Le plus sérieux des risques connus, parce qu'il touchera l'argent réel et
non l'affichage — aucune stratégie n'est activée aujourd'hui, c'est ce qui laisse le temps
de le traiter proprement.

**Mesuré** (2026-09-17) : Hyperliquid renvoie la bougie en cours comme dernière bougie, et
ni le gateway ni le bot ne l'écartent — la dernière bougie 1h de `/analysis` était ouverte
depuis 28 minutes.

Le cron évalue chaque paire 3 à 4 fois par bougie (toutes les 5 min pour une paire 15m,
15 min pour 1h, 1 h pour 4h, 6 h pour 1D), presque toujours en cours de bougie. Le bot
n'entre que sur un signal posé sur la **dernière** bougie (`start`), et sort aussi quand le
rejeu des 500 dernières bougies ne le voit plus en position (`!shouldBeActive`).

**Mesuré ensuite par rejeu** (nest-trading-bot, `docs/trading/forming-candle-replay.md` :
BTC, ETH, SOL ; 3,5 jours en 15m, 17 jours en 1h ; trois stratégies de natures
différentes) :

- **des faux départs systématiques** — d'un cinquième à la moitié des trades du live
  n'existent pas en bougies closes, et jusqu'à plus de la moitié se referment en moins d'une
  bougie : des frais pour un signal que la bougie close n'a jamais porté ;
- **des entrées manquées** — jusqu'à un tiers, voire deux tiers, des entrées confirmées à la
  clôture, quand la nouvelle bougie existe déjà au passage de la frontière ;
- **une frontière qui se joue à une ou deux secondes** — sondé à 12:30:00, le gateway rend
  encore la bougie close jusqu'à ~+1 s, la nouvelle entre +1,9 et +2,8 s selon le coin ; et
  la bougie close gagnait encore des trades après 12:30 : **une bougie n'est pas
  définitive à l'instant de sa clôture**.

Conséquence : le live n'exécute pas la stratégie que le chart backteste. La norme du métier
est de ne décider que sur des bougies closes (Freqtrade n'expose jamais la bougie en cours ;
TradingView appelle le contraire _repainting_) et de confier le risque en cours de bougie
aux ordres posés sur l'exchange. Le traitement est planifié par étapes — voir
[prochaines étapes](#rendre-la-simulation-digne-de-confiance), qui liste aussi les deux
points à ne pas oublier (ATR et ancres latentes/protectrices sur la même fenêtre ;
`waitSeconds` en millisecondes).

En attendant, le chart dit qu'un signal sur la bougie en cours est provisoire
(`watchlist/utils/forming-candle.util.ts`).

## Le `summary` du bot ne décrivait pas la fenêtre affichée

**Fermé** par l'étape B : le `summary` n'existe plus, remplacé par un rapport calculé par
le bot sur la fenêtre demandée. Le constat, gardé pour mémoire : il couvrait **toute** la
fenêtre calculée, amorçage compris. Mesuré sur BTC 1h, 72 h, `close > EMA(50)` : 148 bougies dont
76 d'amorçage, 3 signaux sur 8 hors de l'écran, un bilan de −0,84 % sur 4 trades quand les
sorties visibles à l'écran totalisent −0,12 %. Il additionne aussi long et short, y compris quand les deux se chevauchent.

Le prix d'exécution simulé (clôture de la bougie du signal) reste, lui, l'affaire de
l'étape 3 ; le rapport le suivra sans changement, puisqu'il lit les prix des signaux.

## Précédent

Le dernier risque refermé — une expression malformée faisant rejeter toute la requête
d'analyse, indicateurs compris — a été reproduit, mesuré et corrigé : voir
[watchlist/chart-overlays.md](watchlist/chart-overlays.md#une-expression-malformée-emportait-tout-le-reste).
Il vaut d'être relu comme exemple : le risque avait été écrit sans être vérifié, et la
vérification a montré qu'il était non seulement réel, mais doublé d'un diagnostic faux
affiché à l'utilisateur.
