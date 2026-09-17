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

1. **A — dire ce que la simulation ne fait pas** (mobile). Limites listées sous le bilan,
   sortie implicite annoncée dans le builder, signal sur la bougie en cours marqué
   provisoire. Voir
   [watchlist/chart-overlays.md](watchlist/chart-overlays.md#ce-que-le-backtest-ne-dit-pas).
2. **Étape 0 — mesurer la bougie en cours** (nest-trading-bot, sans rien changer au live).
   Rejouer l'historique comme le bot le vit — cycle par cycle, bougie en cours comprise —
   et compter faux départs, entrées manquées et décalages. Voir
   [risques identifiés](#risques-identifiés).
3. **B — le rapport de simulation** : trades (entrée, sortie, côté, %), courbe de
   performance et pire drawdown **à chaque bougie**, pertes latentes comprises ; long,
   short et total. Seuls comptent les trades dont l'entrée tombe dans la fenêtre affichée,
   une position héritée de l'amorçage se signale à part. Si long et short se chevauchent,
   le rapport le dit — le bot ne peut pas tenir les deux — et peut taire le total. Le
   calcul va dans `trading-shared-types`, pour que le bot le serve ensuite sans le réécrire.
4. **Étapes 1 à 3 côté bot**, chacune annoncée avant d'être commencée : décider sur des
   bougies closes uniquement, traiter chaque bougie une seule fois, et simuler au même
   prix que celui que le live peut réellement obtenir.
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

**⚠️ Ouvert.** Le plus sérieux des risques connus, parce qu'il touche l'argent réel et
non l'affichage.

**Mesuré** (2026-09-17) : Hyperliquid renvoie la bougie en cours comme dernière bougie, et
ni le gateway ni le bot ne l'écartent — la dernière bougie 1h de `/analysis` était ouverte
depuis 28 minutes.

**Lu dans le code, pas encore observé en production** (nest-trading-bot) : le cron évalue
chaque paire 3 à 4 fois par bougie (toutes les 5 min pour une paire 15m, 15 min pour 1h,
1 h pour 4h, 6 h pour 1D), presque toujours en cours de bougie. Le bot n'entre que sur un
signal posé sur la **dernière** bougie (`start`), et sort aussi quand le rejeu des 500
dernières bougies ne le voit plus en position (`!shouldBeActive`). Il en découle, sans
l'avoir encore mesuré :

- **des faux départs** — une condition vraie en cours de bougie fait entrer, redevient
  fausse avant la clôture, et fait ressortir : deux fois les frais pour un signal que la
  bougie close n'a jamais porté ;
- **des entrées manquées** — une condition qui ne devient vraie qu'à la clôture est lue au
  cycle suivant sur l'avant-dernière bougie, donc `start` vaut `false` ;
- **un résultat qui dépend de quelques millisecondes** au cycle qui tombe pile sur la
  frontière de bougie.

Conséquence : le live n'exécute pas la stratégie que le chart backteste. La norme du métier
est de ne décider que sur des bougies closes (Freqtrade n'expose jamais la bougie en cours ;
TradingView appelle le contraire _repainting_) et de confier le risque en cours de bougie
aux ordres posés sur l'exchange. Le traitement est planifié par étapes, en commençant par
une mesure — voir [prochaines étapes](#rendre-la-simulation-digne-de-confiance).

En attendant, le chart dit qu'un signal sur la bougie en cours est provisoire
(`watchlist/utils/forming-candle.util.ts`).

## Le `summary` du bot ne décrit pas la fenêtre affichée

**⚠️ Ouvert.** `AnalysisResponse.strategies[].summary` couvre **toute** la fenêtre
calculée, amorçage compris. Mesuré sur BTC 1h, 72 h, `close > EMA(50)` : 148 bougies dont
76 d'amorçage, 3 signaux sur 8 hors de l'écran, un bilan de −0,84 % sur 4 trades quand les
sorties visibles à l'écran totalisent −0,12 %. Il additionne aussi long et short, y compris quand les deux se chevauchent.

Tant que l'étape B n'est pas faite, le bandeau affiche ce chiffre **avec** ses limites
écrites dessous. B cesse de l'afficher ; corriger le calcul côté bot attend les étapes 1 à
3, qui changent de toute façon les signaux et le prix des trades.

## Précédent

Le dernier risque refermé — une expression malformée faisant rejeter toute la requête
d'analyse, indicateurs compris — a été reproduit, mesuré et corrigé : voir
[watchlist/chart-overlays.md](watchlist/chart-overlays.md#une-expression-malformée-emportait-tout-le-reste).
Il vaut d'être relu comme exemple : le risque avait été écrit sans être vérifié, et la
vérification a montré qu'il était non seulement réel, mais doublé d'un diagnostic faux
affiché à l'utilisateur.
