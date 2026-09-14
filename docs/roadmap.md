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

**Import / export JSON**, détaillé plus bas. C'est la vraie suite : au-delà de la
sauvegarde, il ouvre l'écriture assistée de stratégies.

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

**Aucun n'est ouvert à ce jour.** Le dernier — une expression malformée faisant rejeter
toute la requête d'analyse, indicateurs compris — a été reproduit, mesuré et corrigé :
voir
[watchlist/chart-overlays.md](watchlist/chart-overlays.md#une-expression-malformée-emportait-tout-le-reste).
Il vaut d'être relu comme exemple : le risque avait été écrit sans être vérifié, et la
vérification a montré qu'il était non seulement réel, mais doublé d'un diagnostic faux
affiché à l'utilisateur.
