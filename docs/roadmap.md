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
   au même prix que celui que le live peut réellement obtenir.

   **Fait — 1a, sortir la décision de `processPerp`** (2026-09-17). La fonction qui place
   les ordres décidait sans un seul test, et le script de rejeu portait une copie tenue à
   la main de ses règles. `decidePerpAction` les détient désormais, `processPerp` ne fait
   plus qu'exécuter, et le rejeu appelle le code de production au lieu d'une transcription.
   Comportement inchangé, confronté exhaustivement à l'ancien code.

   **Fait — phase A, les coutures** (2026-09-20), sans changer une seule décision. Elle
   absorbe les deux points qui étaient listés ici comme « à ne pas redécouvrir » :
   - **une seule fenêtre de bougies par passage**, passée explicitement au lieu d'être
     relue par chaque branche de stratégie. Le signal et les protections ne peuvent plus
     décider sur deux fenêtres différentes : les deux lectures traversaient un cache dont
     le seau vaut `max(intervalle / 4, 15 s)`, et rien ne garantissait le même seau ;
   - **le prix live a sa propre source** (`domain/live-price.ts`), journalisée avec la
     valeur. Il vaut toujours le close de la dernière bougie — c'est précisément le seul
     endroit à changer quand il devra cesser de sortir de la fenêtre que la phase B va
     tronquer ;
   - **`waitSeconds` est renommé `waitMs`** : il prenait déjà des millisecondes, et la
     phase B touche justement à ces délais.

   **Fait — garde-fous d'appels vers Hyperliquid** (2026-09-21), avant la phase B parce
   qu'elle touche au cron. Hyperliquid limite le débit par IP sans documenter la sanction, et
   l'audit a trouvé quatre chemins vers un bannissement : un 429 rendu en 500 que le bot
   relançait, des passages accumulés sans borne puis relâchés d'un coup, aucune requête
   bornée dans le temps, et un gateway qui plantait au démarrage et se faisait relancer en
   boucle. Tous fermés ; détail dans `nest-hyperliquid-gateway/docs/rate-limits.md` et
   `nest-trading-bot/docs/known-gaps.md`.

   **Fait — phase B** (2026-09-22) : bougies closes, une décision d'entrée par bougie,
   passages décalés. Les trois étaient indissociables — filtrer sans le garde-fou aurait
   fait voir le même signal 3 à 4 fois, et décaler les crons sans filtrer n'aurait servi à
   rien. Le bot décide **30 s** après la frontière, en UTC, sur la bougie choisie **par son
   heure** (`ouverture + intervalle ≤ maintenant − 30 s`), jamais par sa position dans le
   tableau : juste après la frontière, l'API renvoie encore la bougie qui vient de se fermer
   en dernière position. Le garde-fou ne retient que les entrées, une sortie se réévaluant à
   chaque passage ; au redémarrage, une bougie dont le moment de décision précède le
   démarrage ne déclenche aucune entrée. Le prix d'exécution garde la bougie en cours, sans
   appel de plus.

   **Fait — les deux premiers défauts que la simulation a trouvés** (2026-09-22). Le faux
   gateway et les scénarios de bout en bout ont été écrits pour être dignes de confiance ;
   voici ce qu'ils ont rapporté, corrigé le jour même :
   - **une paire sans bloc `protective` arrêtait tout le passage.** L'app en crée une à
     chaque nouvelle paire, et « Remove all protective configurations » le retire : la
     configuration la plus ordinaire de l'app tuait le passage de l'utilisateur, paires
     suivantes comprises. Le garde manquant est posé, l'échec d'une paire est désormais
     contenu à cette paire — sauf limite de débit et ordre dans un état inconnu, qui
     concernent l'IP et le compte —, et il est journalisé **et** alerté ;
   - **le reste d'un ordre au marché était calculé en virgule flottante.** Sur une sortie
     pourtant complète, le bot lisait une sortie partielle et interrompait le passage : un
     **retournement était perdu**. Tout se compte désormais en chaînes décimales exactes.

   Le second n'était atteignable qu'en faisant répondre un faux exchange fidèle : c'est le
   premier retour sur investissement de cette étape. Détail dans
   `nest-trading-bot/docs/known-gaps.md`.

   **Fait — étape 3, l'écart mesuré puis documenté** (2026-10-14). Le backtest exécute au
   close de la bougie du signal, le live 30 s après : restait à savoir ce que ça coûte.
   Mesuré sur **162 signaux réels** d'un croisement HMA (BTC, ETH, SOL, 15 min, 3 jours),
   compté dans le sens qui dessert le trade — **+1,53 point de base en moyenne** par
   exécution, IC 95 % `[0,22 ; 3,00]`, t = 2,14, **50,6 %** d'exécutions défavorables. Soit
   4 à 9 points de rendement sur 302 trades, contre 27 points pour les frais.

   **La conclusion est de ne pas corriger**, et elle est argumentée plutôt que subie :
   simuler le prix à +30 s demanderait une seconde série de bougies d'une minute à chaque
   backtest — 24 requêtes pour 500 bougies de 4 h, contre la règle qui passe avant tout —
   pour un biais dont le **signe dépend du type de stratégie**, et que la mesure n'établit
   que sur du momentum. Et s'aligner sur l'ouverture de la bougie suivante, comme Freqtrade
   et TradingView, ne déplacerait les chiffres que de 0,12 point de base, `open(T)` valant
   `close(T−1 min)` sur un marché continu. L'écart est donc **écrit sous le bilan**, comme
   le funding et le slippage. Méthode et relevé :
   `nest-trading-bot/docs/trading/execution-price-gap.md`.

   Ce que la phase B laisse ouvert par ailleurs est listé dans
   `nest-trading-bot/docs/known-gaps.md`.

5. **Fait — C, import / export JSON** (2026-10-15), par le **presse-papier**. Le circuit
   visé est ouvert : une IA écrit du JSON, on le colle dans la bibliothèque, on le
   backteste dans `watchlist-detail`, on le confie au bot. Détail des décisions plus bas.

## Plus tard : simuler `latent` et `protective`

Le backtest n'évalue que les règles d'entrée et de sortie. Les ordres latents, les
take-profit / stop-loss et le `exitBehavior` d'une paire ne sont **pas simulés**, alors que
le bot les applique : une paire protégée ne rapporte donc pas ce que le bilan affiche.
C'est dit à l'écran. Les simuler est une évolution à étudier — elle exige de savoir ce qui
se passe à l'intérieur d'une bougie (un stop touché avant ou après le take-profit ?), ce
qu'aucune bougie seule ne dit.

## La régularité : hors de cet écran, et c'est une décision

L'exposition et l'achat-conservation sont à l'écran depuis les types partagés 0.33.0
(2026-10-14), avec le rapport gain/perte : voir [watchlist/chart-overlays.md](watchlist/chart-overlays.md).
Reste la troisième lecture que le `CLAUDE.md` du bot réclame, et elle **n'ira pas ici**.

**La régularité** — sur combien de tranches de 30 jours la stratégie bat la référence —
reste le révélateur de sur-ajustement le moins cher à produire : un gain qui vient de 2
tranches sur 74 n'est pas une stratégie. Mais elle se mesure sur des **tranches de 30
jours**, quand la fenêtre d'un chart en fait souvent sept : l'y porter afficherait
« 0 tranche sur 0 ». Elle vit donc dans les campagnes du harnais (`blocksBeatingHold`),
où les périodes sont longues et choisies pour ça.

⚠️ L'achat-conservation affichée est **brute de frais**, comme chez TradingView
(« Buy & hold return ») et Freqtrade (`market_change`). L'écart avantage la référence, donc
désavantage la stratégie — une asymétrie conservatrice, chiffrée dans la note des limites
plutôt que tue.

## Traité récemment

**Fait** — le thème sombre s'appliquait à moitié. Deux chemins y mènent, la classe
`.dark-theme` et la requête média ; seule la première recevait la palette Ionic, et
`ThemeService` n'ajoute de classe que pour un choix **explicite**. Un utilisateur en mode
`auto` — le défaut — gardait donc l'échelle de paliers claire : cartes blanches sur fond
noir, action-sheet à 1,60:1, texte secondaire à 2,54:1. Les deux branches appliquent
désormais le même mixin, et l'échelle se calcule depuis le fond et le texte au lieu d'être
collée à la main. Mesures avant/après et ce qui reste ouvert :
[theming.md](theming.md).

Trois sujets laissés ouverts par ce chantier, tous chiffrés dans ce document : le texte
des puces Ionic colorées, corrigé seulement là où le défaut avait été constaté ; le vert
de succès d'Ionic, illisible en thème clair (1,68:1), qu'on ne change pas sans décider ;
et les étiquettes rouges sur fond rouge, à 3,84 et 4,18:1.

**Fait** — la modale Protective n'efface plus ce qu'elle n'affiche pas. Elle reconstruisait
chaque entrée à partir de ses trois champs, si bien qu'ouvrir puis cliquer Save suffisait à
perdre le reste : `condition`, que le bot évalue avant de poser la protection,
`protective.enabled`, qu'il lit `!== false`, et les réglages d'ancre, de mode de suivi et
de plancher. Le type ne protégeait rien, un `as ProtectiveOrderEntry[]` affirmant au
compilateur ce que l'objet n'avait pas — `anchor` y est obligatoire et n'était jamais
écrit.

Ce qui s'édite et ce qui se **transporte** sont désormais séparés
(`bot-strategies/domain/protective-entry-form.util.ts`), le transporté voyageant dans la
ligne du formulaire plutôt que dans un tableau parallèle à resynchroniser. Deux décisions
qui vont plus loin que la réparation :

- **l'ancre implicite s'écrit.** Le bot applique `ENTRY` quand aucune ancre n'est déclarée
  (`entry.anchor?.source || 'ENTRY'`) : l'écrire ne déplace aucun prix, ça rend explicite
  ce qui se passait déjà et ça honore le type. Même règle que l'éditeur d'opérande, qui
  écrit les paramètres d'un indicateur même laissés à leur défaut ;
- **un champ inconnu traverse, un champ retiré se nomme.** Les deux ne se confondent pas :
  un inconnu vient peut-être d'un build plus récent et se transporte ; un retiré est une
  décision datée, prise en sachant ce qu'on jette (`RETIRED_ENTRY_FIELDS`). `label` en est
  le premier et, à ce jour, le seul.

Éprouvé par dix mutations, dont deux sur le seul câblage — une conversion juste, branchée à
moitié, redonne exactement le défaut d'avant.

**Fait** — la bande de positions ne tait plus un chevauchement long / short. Constaté en
vérifiant l'étape B : `buildPositionBars` retenait le premier segment couvrant chaque
bougie, si bien que le chart taisait ce que le rapport annonçait. Ces bougies sont
désormais en ambre, et l'avertissement du rapport renvoie à cette couleur. Choix
délibéré contre deux couloirs par stratégie : le chevauchement est un cas que le bot ne
peut pas reproduire, il se signale plutôt qu'il ne se détaille. Voir
[watchlist/chart-overlays.md](watchlist/chart-overlays.md#le-rapport-de-backtest).

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

## Fait : import / export JSON, par le presse-papier

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

L'import existe depuis le 2026-10-15 : les deux boutons de la barre de la page Strategies
copient la bibliothèque entière et ouvrent une zone où coller du JSON ; la feuille d'actions
d'une stratégie porte « Copy as JSON ».

### Les questions du format, tranchées

Les trois ont été réglées **par précédent** plutôt qu'au goût, et `strategy-transfer.util.ts`
porte le raisonnement :

- **un lot**, parce que `StrategyLibraryService.importMissing` prend déjà un tableau — une
  stratégie seule est un tableau d'un ;
- **l'`id` est conservé**, comme le fait délibérément la migration des anciens charts : ça
  rend l'import idempotent et laisse un sens aux références. Jamais au prix d'un
  écrasement, voir ci-dessous ;
- **un `schemaVersion` plus élevé n'est pas rabaissé** : le document continue de se déclarer
  comme venant d'un build plus récent, ce dont `isFromNewerSchema` se sert pour avertir.

⚠️ Le seul écart avec l'existant est voulu. `importMissing` saute un `id` déjà connu **sans
un mot** : c'est juste pour une reprise de données, où l'on ne veut pas remplacer ce que
l'utilisateur a édité, et faux pour un texte étranger — coller trois stratégies et n'en voir
apparaître que deux en silence est la défaillance que ce dépôt met en premier. Un `id` pris
donne donc « déjà là » quand le contenu est identique, sinon une **copie sous un nouvel
`id`**, annoncée. Et chaque entrée refusée est nommée, jamais comptée.

⚠️ **Le presse-papier, et pas un fichier.** `@capacitor/filesystem` et `@capacitor/share`
sont absents, et aucun dossier `android/` n'existe encore : il n'y aurait rien pour les
éprouver. Mesuré dans le navigateur le 2026-10-15, **lire** le presse-papier est refusé
(`NotAllowedError`) ; l'import prend donc son texte dans une zone de saisie, et seule
l'écriture passe par `navigator.clipboard`.

⚠️ L'import **n'appelle pas** `POST /exchanges/strategies/validate` : la bibliothèque
accepte déjà les brouillons, et la validation vit là où elle se montre déjà — le builder,
l'attachement à un chart, l'envoi au bot.

## Plus tard : une bibliothèque persistante

Le jour où plusieurs appareils ou plusieurs utilisateurs entrent en jeu. Cela passera par
le service utilisateur, et demandera de décider à qui appartient une stratégie — à
l'appareil ou au compte. Ce n'est pas un chantier de code, c'est une décision d'abord.

## Plus tard : le mode de marge et le levier depuis le mobile

**Non prioritaire.** Le formulaire d'ordre affiche le mode et le levier d'une paire
(« Cross · 3x / 25x ») mais ne sait pas les changer : `updateLeverage` reste un `TODO` dans
`core/services/hyperliquid-gateway.service.ts`. Mesurer la marge isolée le 2026-11-13 (point 15
de « À éprouver en réel ») a demandé de passer ETH en isolé 3x sur l'interface web
d'Hyperliquid. Or l'estimation de liquidation de la confirmation ne vaut **qu'en isolé** : sans
ce réglage, elle n'est accessible qu'en passant par le web.

Ce que ça demandera :

- le contrat du gateway (`nest-hyperliquid-gateway`) et des types partagés ;
- la doc d'Hyperliquid lue en brut : `updateLeverage`, et le mode de marge qui ne change pas
  avec une position ouverte sur la paire ;
- un refus d'Hyperliquid montré, jamais muet.

Dans l'app, une petite feuille ouverte depuis la ligne du levier.

## En cours : le trailing stop natif, en plus du stop du bot

Hyperliquid a ajouté le trailing stop natif le 2026-09-21. Le but est de pouvoir le **poser et le remplacer depuis
l'app**, **en plus** du stop intelligent du bot, jamais à sa place (décidé le 2026-11-16).

**Fait le 2026-11-16.**

- **La mesure** de ce que l'API en rend : `nest-trading-bot/docs/hyperliquid/live-check.md`, « Le trailing stop natif ».
- **Le garde-fou** : les trois dépôts le prenaient pour un stop ordinaire. Ici, « Edit Order » le refuse et dit pourquoi
  (`open-orders/editable-order.util.ts`). Le bot et le gateway le laissent intact.

**Reste à faire, dans cet ordre.**

1. **Le gateway** : l'action `trailingStop` (dont la doc n'a ni réponse d'erreur ni `cloid`), une route validée, et la
   signature éprouvée en réel. Son type rejoint `hl-shared-types` avec la liste des `orderType` connus.
   **Écrit le 2026-11-17, pas encore éprouvé en réel** : `POST /orders/trailing-stop` refuse une valeur hors grille au
   lieu de la tronquer et ne relance jamais (voir `nest-hyperliquid-gateway/docs/trailing-stop.md`) ; `hl-shared-types`
   porte l'action, `HL_ORDER_TYPE` et `parseTrailingStopCondition`, que l'affichage (2) lira. La mesure de la signature
   attend la publication du paquet et la sonde `trailing-stop-api.ts` du bot, lancée par l'utilisateur.
2. **L'affichage** : l'état lu dans `triggerCondition` (en attente à X, ou suit depuis W et déclenche à T), une ligne
   propre sur le chart. Le déclencheur est hors de la grille des prix, et vaut `"0.0"` en attente.
   **Écrit le 2026-11-17** : `open-orders/trailing-stop-view.util.ts`, lu par la liste, le détail et le chart (voir
   [watchlist/chart-overlays.md](watchlist/chart-overlays.md#le-trailing-stop-natif--son-niveau-actuel-jamais-son-passé)).
   `limitPx` ne s'affiche plus pour ce type, ni « Trigger 0.0 », ni la taille en dollars qui en découlait.
   **Vu dans le navigateur le 2026-11-17**, sur un achat reduce-only en suivi et un achat en attente sous 1 250, en clair,
   en sombre et à 360 px, le chart par capture. La vérification a trouvé et corrigé deux défaillances muettes du chart :
   une activation hors de l'échelle se dessinait hors du canvas (elle se colle désormais au bord, avec une flèche :
   `pinToPane`), et une étiquette posée au bord droit perdait sa fin.
   ⚠️ Deux points ouverts, mesurés le même jour (`nest-trading-bot/docs/hyperliquid/live-check.md`, S5) :
   - **le détail montre un stop périmé** : la liste lit `frontendOpenOrders`, le détail `orderStatus`, et **tranché le
     même jour par un déclenchement réel** (`live-check.md`, S6) : `orderStatus` rend l'état de la pose, figé, et son
     stop n'est pas appliqué (rempli 0,255 % sous lui). **Corrigé le même jour** : pour un trailing ouvert, le détail
     lit aussi `frontendOpenOrders` (poids 20) et en prend l'état et les prix (`liveTrailingState`) ; absent de la
     liste, il le dit au lieu de montrer l'état de la pose. Un trailing qui n'est plus ouvert s'affiche « Ended », avec le
     dernier texte de l'exchange (`"Triggered"` une fois déclenché, que le lecteur strict ne connaît pas). **Vu dans le
     navigateur** le même jour, en clair, en sombre et à 360 px : le trailing ETH ouvert affiche 1 847,93 quand
     `orderStatus` répond 1 854,0, et le trailing BTC rempli « Ended (filled) ». La vérification a trouvé une fausse
     alerte plus ancienne : le détail d'un ordre déclenché **et rempli** disait « 0.0 is still resting … not
     protected » ; `isStuckTriggeredOrder` lit désormais le statut. ⚠️ Le cas « absent de la liste » n'a été vu qu'en
     test : il demande un déclenchement entre les deux lectures ;
   - l'exchange écrit `3.5000000000000004%` : **réglé le même jour**, le repli s'affiche arrondi à quatre décimales, la
     précision d'une action signée (`3.5 %`), et le détail montre le texte brut sous « Exchange text ».
3. **La pose** depuis une position : reduce-only, à la taille de la position par défaut, l'unité de chaque champ écrite
   (`%` ou prix). Une saisie prise pour un pourcentage a été refusée par l'exchange pendant la mesure.
   **Écrit le 2026-11-17, sans formulaire encore** : la validation de la saisie (`open-orders/trailing-stop-entry.util.ts`),
   qui reprend les refus du gateway et refuse l'activation du mauvais côté ; et la lecture d'un 400 du gateway par
   `errors` (`extractErrorMessage`), qui affichait « Validation failed » sur **toutes** les routes.
   **Avant le formulaire, décidé le même jour : la carte d'une position dit ce qui la fermerait** — ce qui manquait le
   plus. Deux ronds de 14 px à côté de LONG / SHORT (`perp-summary/components/coverage-pie`), lus dans
   `frontendOpenOrders` de son dex (`perp-summary/position-protection.util.ts`, la règle de couverture du bot recopiée,
   deux écarts écrits en tête du fichier) :
   - **SL** : vide rouge, part orange, plein vert (le pourcentage écrit à côté a été retiré le 2026-11-18) ;
   - **TP** : vide gris (l'absence est un choix, pas une alerte), part ou plein vert ;
   - gris en pointillé quand les ordres n'ont pas pu être lus ;
   - un **robot** sur les paires que le bot gère (profil utilisateur, sa règle `enabled` stricte) : ses ordres n'ont pas
     de `cloid`, mais sur ses paires il tient tous les SL/TP. ⚠️ C'est la configuration, pas la preuve qu'il tourne ;
   - **ⓘ** seulement s'il y a quelque chose à dire, en quelques mots dans une bulle (« SL triggered, still resting »,
     « Trailing waits > 2355 ») ; orange quand la note change la lecture ;
   - dans le bloc déplié, une ligne `SL 1788.6 +1 · TP 2100` : les niveaux les plus proches du prix.

   Le bot ne publie pas son propre verdict : aucune route ne l'expose. Une première version écrivait `PROTECTED` /
   `UNPROTECTED` en toutes lettres, et les explications en phrases : deux lignes de plus par carte, remplacées le même
   soir à la demande de l'utilisateur. **Vu dans le navigateur le 2026-11-17**, en clair et en sombre, à 360 px,
   contrastes calculés (symboles ≥ 4,51:1 en clair, ≥ 6,00:1 en sombre ; seuil 3:1) ; le pire cas (`xyz:BRENTOIL`,
   deux parts, robot, ⓘ) passe sur deux lignes sans déborder — le bloc SL · TP · robot · ⓘ **entier** (`.coverage`,
   insécable), mesuré à x = 16 sur la seconde ligne, au lieu de laisser SL en haut et TP en bas comme d'abord. ⚠️ Le compte n'avait **plus aucune position** ce
   soir-là : la lecture réelle (0 position, 0 ordre, aucune paire au bot) a été vérifiée, mais les ronds ont été vus sur
   des positions **injectées** dans la page, aux formes d'ordres mesurées. **Puis vu sur une vraie position**, le même
   soir à 22:28 : un short `xyz:NVDA` de 0,138, couvert par un trailing posé depuis l'interface officielle (achat
   reduce-only, `Activation immediate, retracement 4%, best 160.13`, `triggerPx` 166.535 = 160,13 × 1,04). La carte
   montre SL plein vert, TP vide gris, et `TS 166.535` dépliée, en clair et en sombre, à 360 px. Reste à voir une vraie
   position couverte par le stop du bot. ⚠️ La page ne lit que les dex **cochés** dans son sélecteur : la position
   n'apparaissait pas tant que `xyz` n'y était pas — ce n'est pas une absence de position, c'est un filtre, et la
   page ne le dit pas. ⚠️ Le sens du seuil d'un **take-profit** (`Price above` pour fermer un long) est
   déduit par symétrie de celui du stop, mesuré : un désaccord ne compte pas (et ne se voit plus que comme un rond
   rouge, depuis le retrait de la bulle).

   **Revu le 2026-11-18, après usage sur le téléphone**, à la demande de l'utilisateur :
   - la carte ne garde que les ronds : ⓘ, sa bulle et la ligne `SL … · TP …` retirés. Le robot n'est plus une icône à
     part : **un rond par source**, avec une pastille posée dessus — robot pour le bot, **escalier** pour le trailing
     natif (choisi parmi six), rien pour un ordre manuel. Le stop du bot et un trailing qui cohabitent font deux ronds
     SL, chacun avec sa part. ⚠️ Profil illisible : les ordres ordinaires se disent manuels (le robot manque, la
     couverture reste juste) ;
   - les badges de côté perdent `OPEN` / `CLOSE` au profit d'un glyphe plein, ▶ ouvre, ■ ferme (`app-side-badge`), et
     **la couleur suit le mot** : `■ SHORT` est rouge, comme le short qu'il ferme. Open Orders, détail, History, Trade
     History, positions ;
   - les toasts d'ordre passent par `OrderToastService` : un seul toast par envoi, une ligne par ordre, vert si tout
     est passé, rouge dès qu'une ligne échoue. Ionic présentait chaque toast au même endroit, le dernier masquant les
     autres ;
   - la page des positions ne lit plus les ordres d'un dex **sans position** (20 de poids par dex coché), et ne relit
     au premier plan qu'une fois par minute.

   **Mesuré dans le navigateur le 2026-11-18**, à 360 px, en clair et en sombre, sur la vraie position `xyz:NVDA` et
   des cas injectés (`xyz:BRENTOIL`, paires du bot) : centres du badge, de son glyphe, des libellés, des ronds et des
   pourcentages alignés au dixième de pixel près (l'encre des capitales Roboto est 0,15 px au-dessus du centre de sa
   boîte) ; pastilles 6,37:1 en clair et 6,00:1 en sombre sur leur fond, qui se détache à 6,26:1 et 8,65:1 du rond
   vert ; un toast de trois lignes fait trois lignes (60 px pour 20 de hauteur de ligne). La vérification avec
   `xyz:BRENTOIL` a trouvé un défaut plus ancien : dans Trade History, le nom **chevauchait** le badge de 12 px.
   L'en-tête passe désormais à la ligne, badge en dessous à droite. ⚠️ Le regroupement des toasts n'est vu qu'en
   test et avec un toast présenté à la main : aucun ordre n'a été posé.

   **Repris le même soir, après un second passage sur le téléphone** : les badges ▶ / ■ mesuraient **21,2 px** contre
   18,02 pour `Limit` ou `ALO`. Le composant passait l'`ion-badge` en `flex`, ce qui annule le rognage global sur les
   capitales (`text-box: trim-both cap alphabetic`, `styles.scss`). Le badge redevient un `ion-badge` ordinaire et le
   glyphe un SVG en ligne, relevé de `0,3555em − 3,5px` (demi-hauteur des capitales Roboto moins demi-glyphe). Mesuré à
   360 px, en clair et en sombre, sur Open Orders, History et la carte de position, pour ▶ et ■, LONG et SHORT :
   18,02 px partout, glyphe à 0,00 px du centre des capitales, texte à 0,03 px du centre du badge, 4 px de chaque côté.
   Dans Open Orders et History, **les badges forment un bloc insécable** (`.order-tags`) qui passe à la ligne entier
   sous un nom long : avec `xyz:BRENTOIL` et `Trailing Stop Market` / `Take Profit Market`, tous à x = 16 sur la
   seconde ligne. Les ronds de protection ne portent plus de pourcentage : la part et la couleur suffisent.

   **Puis, vu sur le téléphone : « tous les textes trop bas de 1 à 2 px, sauf HIP-3 ».** Dans le navigateur de
   développement, le chemin `text-box` est centré (0,01 px, encre mesurée, en Arial comme en Roboto chargé). Le
   **repli** ne l'était pas : réglé sans le savoir sur Arial (Roboto manque au PC de développement), il laissait sur
   Roboto le texte 0,69 px trop bas, 0,29 sur HIP-3 — la même forme que ce qui a été vu, et la première explication
   donnée. **Elle était fausse** : le téléphone (Xperia 1 III, Android 13, Chrome 157, relevé le 2026-11-19) gère
   `text-box` et ne lit pas le repli. Le repli reste corrigé (0,09 et 0,18 px sur Roboto), mais l'écart vu sur
   l'appareil n'est **pas expliqué**. L'utilisateur précise que les badges d'avant ▶ / ■ y étaient bien centrés.
   Plutôt qu'un troisième réglage fin, le glyphe sort du flux du texte (absolu, centré sur la boîte) : la ligne
   d'un badge redevient son seul texte, comme avant ▶ / ■. ⚠️ **Pas encore vu sur le téléphone** : à confirmer
   sur une capture native, mesurée au pixel. Le même jour, les badges gris d'un trailing stop natif (`Trailing`, `Trailing Stop
Market`) prennent l'escalier de la pastille du rond (`app-order-type-badge`), en trois marches à 7 px.

   **Le 2026-11-19** : l'escalier passe à 9 px (un trait fin pesait moins que ▶ et ■ à 7 px) ; un TIF hors de `Gtc` /
   `Alo` / `Ioc` s'affiche tel que l'API l'écrit (`FrontendMarket`, et non plus `FRONTENDMARKET`) ; et l'ouverture
   prend ▲ pour un LONG (un achat) et ▼ pour un SHORT (une vente) au lieu de ▶, la convention des marqueurs d'achat et
   de vente de TradingView et déjà celle des exécutions sur le chart de la watchlist. ■ ferme, inchangé. Écartés : le
   texte de l'API en toutes lettres (`Open Long`, `Close Short`, qui tenait à 360 px sur History, mesuré),
   `BTO` / `STO` / `BTC` / `STC` des options américaines. ⚠️ **Incohérence ouverte** : les marqueurs de stratégie du
   chart (`strategy-markers.util.ts`) disent flèche haute = entrée, flèche basse = sortie, quel que soit le côté ; un
   ▼ y veut dire « sortie », dans un badge « ouvre un short ». Toujours ouverte, **pas prioritaire**. Essayé le
   2026-11-19 puis annulé : ▲ / ▼ pour une entrée dans le sens de l'ordre, ■ pour une sortie, achat sous la bougie
   et vente au-dessus. Sur une stratégie qui se retourne (HMA 9/21), chaque croisement empile un ■ et une flèche,
   et le chart était **trop chargé** en vue dense (1W / 1H, vu à 360 px). Le carré ne peut pas y être allégé :
   lightweight-charts 5.2 le dessine à 0,7 fois la flèche (9 px contre 13), et son option `size` est bornée par
   un minimum de 12 px. Une reprise devra d'abord répondre à cette densité.

   **Sur une paire du bot, le bouton « Trail »** : la cohabitation est mesurée (2026-11-16,
   `nest-trading-bot/docs/known-gaps.md`), mais un trailing plus serré que le stop du bot devance la sortie que le
   backtest a éprouvée. Le formulaire devra le dire.

   **Le formulaire, écrit le 2026-11-19** (`open-orders/trailing-stop-form`) : une ligne « Protect · Trail » sur la
   carte dépliée d'une position (sur la ligne « Close », il fallait 276 px pour 232 à côté du mini-graphique, à 360 px).
   Taille (25 à 100 %), repli en `%` ou en `$` (l'unité écrite à côté du champ), activation facultative, contrôlés à la
   saisie par `planTrailingEntry` sur le marqué et la grille lus dans `metaAndAssetCtxs` du dex (poids 20). L'écran dit
   le stop au départ et sa valeur au déclenchement, liste les trailings déjà posés sur la paire, et sur une paire du bot
   dit si le trailing part plus serré que le stop du bot (`botStopNotice`). Un échec se range en « rien n'est posé »
   (400, ou refus de l'exchange) ou « issue inconnue » (`trailingSendFailure`) : dans le second cas l'écran se
   verrouille et relit les ordres une fois, **jamais de second envoi** (pas de `cloid`). **Vu dans le navigateur** sur
   `xyz:BRENTOIL` à 360 px, en clair et en sombre : refus du mauvais côté à la saisie, aperçu juste (90,103 × 0,9 =
   81,0927), confirmation ouverte puis annulée. **Premier envoi réel le même jour à 16:55**, par l'utilisateur depuis
   l'app : une seule action signée (journal du gateway : actif 110049, vente reduce-only de 0,15, `10.0000%`, sans
   activation), oid 610331573505 ; relu dans Open Orders : `Stop 80.6796 · best 89.644 · 10 %` (89,644 × 0,9), taille
   0,15/0,15, reduce-only. Le chart affichait au même moment `TS 80.6562` (89,618 × 0,9) : l'état de sa lecture
   précédente, en cache — la limite connue, le stop était monté entre-temps. ⚠️ Le cas « issue inconnue » et l'avis du
   stop du bot ne sont vus qu'en test.

4. **Le remplacement**, qui n'est pas une modification : poser le nouveau, puis annuler l'ancien. L'écran dit que le
   suivi repart du prix marqué du moment.

   **Écrit le 2026-11-19, pas encore envoyé en réel** (`open-orders/trailing-stop-replace.util.ts`, et le formulaire
   Trail en mode `replacingOid`). Le point d'entrée est le crayon du détail d'un trailing : actif seulement s'il est
   ouvert, reduce-only et que son état **courant** est lu (`canReplace`). Le crayon relit la position (poids 2) et
   refuse une position fermée ou retournée depuis la pose. Le formulaire reprend la taille et le repli de l'ancien
   (`trailingPrefill` : le pourcentage arrondi à quatre décimales, l'activation seulement s'il attend encore), et
   compare l'ancien stop courant au nouveau stop au départ (`stopChange`) : orange s'il est plus lâche, sans bloquer.
   L'ordre est fixe : **poser, puis annuler** ; après une pose à l'issue inconnue, l'ancien reste. Une annulation qui
   échoue dit « Two trailing stops now protect this position » et propose « Cancel the old one », qui se renvoie sans
   risque ; un ancien qui n'était plus ouvert se dit (`gone`). **Vu dans le navigateur** à 360 px, en clair et en sombre
   (orange 5,43:1 et 8,68:1, rouge 6,20:1 et 6,11:1), avec l'état mesuré du trailing BRENTOIL **injecté dans la page** :
   ce trailing n'était plus ouvert au moment de la vérification. Rien n'a été envoyé, et les écritures vers le gateway
   étaient bloquées. L'état « deux trailings » a été posé à la main dans le composant, pour voir sa mise en page.
   **Premier remplacement réel le même jour à 17:35**, par l'utilisateur depuis le détail du trailing 10 %
   (oid 610366939959) : le 7 % posé (oid 610375977814), puis l'ancien annulé, réponse `statuses: ["success"]`. Une seule
   pose, une seule annulation. **Mais la page de détail relisait ensuite l'ancien oid**, et `orderStatus` répondait
   encore `open`, avec l'état de la pose, alors que `frontendOpenOrders` ne le listait déjà plus. L'écran disait
   « Status open » et « Not in the open orders list ». Relu à 17:36:55 : `canceled`, horodaté 17:35:07. **Corrigé le
   même jour** : le formulaire rend `{ kind: 'replaced' }`, et le détail revient à la liste (`afterTrailingForm`). La
   réponse de l'annulation fait foi, et la liste lit `frontendOpenOrders`. **Vu en réel le même jour à 18:36**, sur un
   second remplacement (7 % → 5 %) :
   - l'écran annonçait `85.6244` au départ (90,131 × 0,95), contre `84.1715` pour l'ancien (90,507 × 0,93), « tighter » ;
   - une pose (oid 610455230013), puis l'annulation de 610375977814 (`success`), et le toast « Replaced » ;
   - le détail est revenu à la liste **sans relire l'ancien oid** (aucun `GET` après l'annulation) ;
   - la liste ne montrait que le nouveau trailing, `Stop 85.6558 · best 90.164 · 5 %` : `frontendOpenOrders` le listait
     dès le retour, et il avait déjà suivi un nouveau plus haut.

   **Vu en réel avant ce remplacement** : passé par le bouton Trail de la carte en pensant remplacer, l'utilisateur a
   ajouté un second trailing (8 %). Le formulaire ne propose le remplacement que depuis le détail. C'est un point
   d'entrée à revoir : un bouton Replace sur chaque trailing listé dans le formulaire.

   ⚠️ **Pas encore vu en réel** : une annulation refusée. Et le texte reconnu pour `gone` (« Order was never placed,
   already canceled, or filled. ») vient de la doc, pas d'une mesure.

⚠️ **Mesuré le 2026-11-17, à reporter dans la pose (3)** : l'exchange **accepte** une activation du mauvais côté (une vente
activée sous le marqué) et la suit tout de suite, sans rien dire. Le client officiel refuse cette saisie ; le gateway aussi
depuis le même jour (400), l'app devra le dire dès la saisie. Et un 400 du gateway arrive sans son code (`"message":"Validation failed"`, le texte dans
`errors`) : l'écran doit lire `errors`. Détail : `nest-hyperliquid-gateway/docs/trailing-stop.md`.

⚠️ **Pas mesuré** : l'activation et le déclenchement d'un trailing, un achat, un dex HIP-3.
**Vu le 2026-11-17 au soir** : un trailing natif **existe sur un dex HIP-3**. Un achat reduce-only sur `xyz:NVDA`, posé
depuis l'interface officielle, se lit dans `frontendOpenOrders` du dex `xyz` sous la même forme qu'au dex principal
(`limitPx` 183.18 ≈ stop × 1,1). **La pose y est mesurée le 2026-11-19** (`xyz:BRENTOIL`, S7 de
`nest-trading-bot/docs/hyperliquid/live-check.md`) : le gateway l'accepte depuis `d7f8273` et lit le marqué du contrôle
d'activation sur le dex de la paire ; l'exchange a accepté notre signature pour l'actif 110049, le trailing a suivi
(stop = best × 0,9) et s'est annulé par la route ordinaire. `planTrailingEntry` accepte HIP-3 depuis le même jour.
Non mesurés sur HIP-3 : une activation atteinte, un déclenchement, un achat.

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
  définitive à l'instant de sa clôture**. Mesuré à nouveau le 2026-09-21 sur quatre
  frontières : elle a bougé **jusqu'à 4-6 s** après la clôture, son close compris, puis
  plus rien jusqu'à +20 s. Le délai varie d'une mesure à l'autre ; la phase B décidera à
  +30 s, soit une marge de 5 sur le pire cas vu.

Conséquence : le live n'exécute pas la stratégie que le chart backteste. La norme du métier
est de ne décider que sur des bougies closes (Freqtrade n'expose jamais la bougie en cours ;
TradingView appelle le contraire _repainting_) et de confier le risque en cours de bougie
aux ordres posés sur l'exchange. **Corrigé côté bot le 2026-09-22** (phase B) : il décide
sur la bougie close, 30 s après la frontière, et entre au plus une fois par bougie. Reste
l'étape 3, le prix simulé du backtest — voir
[prochaines étapes](#rendre-la-simulation-digne-de-confiance).

Le chart dit qu'un signal sur la bougie en cours est provisoire
(`watchlist/utils/forming-candle.util.ts`) ; le bot, désormais, l'ignore.

## Le `summary` du bot ne décrivait pas la fenêtre affichée

**Fermé** par l'étape B : le `summary` n'existe plus, remplacé par un rapport calculé par
le bot sur la fenêtre demandée. Le constat, gardé pour mémoire : il couvrait **toute** la
fenêtre calculée, amorçage compris. Mesuré sur BTC 1h, 72 h, `close > EMA(50)` : 148 bougies dont
76 d'amorçage, 3 signaux sur 8 hors de l'écran, un bilan de −0,84 % sur 4 trades quand les
sorties visibles à l'écran totalisent −0,12 %. Il additionne aussi long et short, y compris quand les deux se chevauchent.

Le prix d'exécution simulé (clôture de la bougie du signal) reste, lui, l'affaire de
l'étape 3 ; le rapport le suivra sans changement, puisqu'il lit les prix des signaux.

## Le champ `label` des protections : retiré, son origine inconnue

**Arbitré le 2026-09-26.** Mesuré sur le compte de développement : les quatre entrées
protectrices de `vntl:ROBOT` portaient un `label: ''` qui n'existe dans aucun type partagé.
Cherché sans succès dans les cinq dépôts **et** dans `nest-mongo-user`, qui stocke
`tradingSettings` en `Record<string, any>` sans schéma par champ : aucun lecteur, nulle
part. Un vestige d'un build précédent.

Il est retiré **nommément** (`RETIRED_ENTRY_FIELDS` dans
`bot-strategies/domain/protective-entry-form.util.ts`), et pas par omission. La nuance
porte tout le reste : ce qui est inconnu se transporte, ce qui est retiré se décide. Une
liste blanche « on ne garde que ce qu'on connaît » rendrait exactement le défaut que cette
passe vient de réparer, et deux tests la refusent — dont un sur le `distance` que l'étape
suivante va introduire, précisément le champ qu'un mobile en retard rognerait.

La suppression est **paresseuse** : elle a lieu quand la modale d'une paire est ouverte
puis enregistrée, pas avant. Aucune migration ne balaie les documents.

**⚠️ Ce qui reste ouvert** : d'où venait ce champ, et s'il existe d'autres vestiges du même
genre ailleurs dans le document utilisateur. Rien n'a cherché hors des entrées protectrices.

## Le formulaire d'ordre disparaissait quand `activeAssetData` échouait

**✅ Corrigé le 2026-10-16** — découvert en réparant le « NaN » du champ de prix
(`open-orders/open-form/active-asset.util.ts`), reproduit, puis traité avec la décision
« bloquer l'envoi ».

**Ce qui était mesuré.** On fait échouer l'appel `activeAssetData` de l'API publique après
avoir choisi un actif : la modale « New Order » passait du formulaire complet (sens, sélecteur
d'actif, bouton PLACE) à **« New Order / No data found »**. Aucun toast ; la seule trace était
`loadActiveAssetData error … status: 0` dans la console. Et le prix de l'actif **précédent**
restait en mémoire (le prix de BTC sous un ETH choisi). La cause : l'échec était rendu par
`null`, que `RefreshableLayout` lit comme « vide ».

**Ce qui est fait.**

- L'échec rend un **marqueur typé et gelé**, `ACTIVE_ASSET_UNAVAILABLE`, comme « aucun actif
  choisi » rend `NO_ASSET_SELECTED`. Le layout reçoit un objet non nul : le formulaire reste
  affiché.
- Un **bandeau** dit pourquoi, avec un bouton **Retry** (le même appel que le changement
  d'actif). Le prix et le levier passent à `null` — jamais le prix de l'actif précédent — et
  sont aussi remis à zéro à chaque changement d'actif.
- **L'envoi est bloqué** tant que le prix manque, par le bouton **et** par `submit()` lui-même.
  Pourquoi : sans prix, `isPriceInvalid` rend `false`, et le garde-fou « un achat limite ne
  passe pas au-dessus du marché » cesse de s'exercer ; un ordre ainsi placé s'exécuterait
  aussitôt comme taker. C'est l'option qui échoue bruyamment et tôt.
- Un prix **illisible** (`markPx` qui n'est pas un décimal strictement positif) compte comme
  indisponible : même conséquence.

**Mesuré après correction**, dans le navigateur, avec une vraie session : appel en échec →
formulaire visible, bandeau, Retry, bouton désactivé alors que les champs sont valides (donc
c'est bien l'absence de prix qui bloque), prix `null`, `submit()` refusé avec le message ;
après Retry → état `ok`, prix de l'actif, bandeau parti, bouton actif.

**⚠️ Le spot, découvert en chemin — et pas un détail.** `activeAssetData` est une requête de
**perps** : l'API répond **500** pour `PURR/USDC` (mesuré sur cet actif seulement). Le spot
était donc déjà inutilisable depuis ce formulaire, avec exactement le même « No data found »,
et chaque choix d'actif spot envoyait une requête qui échouait à coup sûr. Désormais aucune
requête n'est envoyée pour un actif spot, un bandeau dit « the price check is not available
for spot markets yet », et l'envoi est bloqué. **Ce n'est pas une régression, mais ce n'est
pas non plus une réparation : passer un ordre spot depuis ce formulaire reste impossible.**
Il manque une source de prix pour le spot (méta spot, ou mids), à décider. Le spot n'a été
mesuré que sur `PURR/USDC`.

**Pas couvert par un test automatisé** : le câblage du composant (`isFormInvalid`, le garde de
`submit()`, le bandeau). Les décisions sont dans des fonctions pures testées (40 tests, neuf
mutations tuées) ; le câblage n'a été vérifié que dans le navigateur.

## Le bouton « + » disparaissait avec la liste vide

**✅ Corrigé le 2026-10-16.** Signalé par l'utilisateur : plus de bouton « + » sur
« Open Orders ».

**Mesuré.** Sans ordre ouvert, `RefreshableLayout` est dans l'état vide (`isEmpty()` vrai) et
n'affiche **que** le message « No open order found » : son contenu projeté — dont le
`<ion-fab>` posé par la page — n'était pas rendu. Le bouton n'existait donc pas dans le DOM, et
sans lui on ne pouvait créer aucun ordre depuis cette page. Rien n'était cassé par un changement
récent : le commutateur vide / contenu du layout date du 2026-03-27, le bouton a été ajouté dans
ce contenu le 2026-06-26, et il n'a été visible que tant qu'il y avait au moins un ordre.

**Les traces d'un défaut déjà rencontré.** `strategies` et `watchlist` posent leur bouton
**à côté** du layout plutôt que dedans : un contournement du même piège, jamais écrit.

**Ce qui est fait.** Le layout a un emplacement `<ng-content select="ion-fab" />` **toujours
rendu**, hors des blocs vide / contenu. Une page n'a rien à changer : son `<ion-fab>` y est
projeté tout seul. Mesuré avec la liste vide : le bouton est dans le DOM (56 × 56 px, dans la
fenêtre), et un clic ouvre bien le formulaire d'ordre. « Bot Strategies », la seule autre page à
poser son bouton dans le layout, n'est pas touchée (sa donnée n'est pas une liste).

**⚠️ Pas vérifié.** Le cas avec au moins un ordre ouvert — aucun n'existe sur le compte de
développement, et en placer un n'est pas un test acceptable. Le contenu projeté par défaut n'a
pas changé, seul l'emplacement du bouton, mais ce n'est pas mesuré. `strategies` et `watchlist`
n'ont pas été ramenés dans le layout : ils fonctionnent, et le faire serait un changement sans
gain visible.

## Modifier un ordre déclencheur remplaçait son prix limite

**✅ Corrigé le 2026-10-16.** Trouvé en examinant si la réécriture du prix limite à la bascule
Market/Limit était voulue.

**Mesuré.** L'effet qui dérive le prix limite du déclencheur (déclencheur ± 0,1 %) n'avait **pas
de garde `isModify()`**, contrairement à l'effet voisin. Formulaire ouvert en modification sur
trois ordres factices (rien n'a été envoyé) : un _Stop Limit_ et un _Stop Market_ de limite
80000 et de déclencheur 81000 affichaient **81081** dès l'ouverture, avant tout geste de
l'utilisateur ; un ordre limite simple restait intact. Un « Update order » aurait donc envoyé un
autre prix limite que celui de l'ordre, sans avertissement.

**Ce qui est fait.** Le **déclencheur est l'ancre** : c'est la décision (« à ce prix, j'agis »),
le limite n'est que le pire prix accepté. La décision est une fonction pure testée,
`limitFromTrigger` (`open-orders/open-form/order-limit.util.ts`) :

| Ordre déclencheur  | Écart du limite avec le déclencheur | Pourquoi                                              |
| ------------------ | ----------------------------------- | ----------------------------------------------------- |
| au marché          | **10 %**                            | la borne que l'exchange applique lui-même (mesuré)    |
| Stop Loss limite   | **5 %**                             | doit sortir ; en deçà de la liquidation à fort levier |
| Take Profit limite | **1,5 %**                           | garde le prix visé ; exemples officiels 1,7 et 2,2 %  |

Sous le déclencheur pour une vente, au-dessus pour un achat, dans tous les cas. Ces trois valeurs
sont, pour un déclencheur **limite**, des **choix** (validés le 2026-10-16), sources et
raisonnement dans l'en-tête de `limit-spread.util.ts` ; l'ancien écart unique de 0,1 % était dix
fois plus serré que l'exemple de Freqtrade. **Pour un déclencheur au marché, le 10 % n'est pas un
choix** : c'est la borne que l'exchange recalcule lui-même et dont il ignore le `p` envoyé (mesuré le
2026-10-18, voir « À éprouver en réel », point 1), arrondie comme lui par `marketTriggerBound`. Le
formulaire **dit**, sous le champ limite et sur deux lignes (« −5,00 % from trigger » puis
« default for Stop Loss », « edited », « exchange bound » ou « as placed »), d'où vient le limite. Sur une seule ligne le texte était tronqué à 360 px ; une marge de 10 px sous la dernière
ligne l'empêche de toucher la valeur (le libellé empilé d'Ionic est réduit à 75 %).

Règles de cohérence, toutes mesurées dans le navigateur le 2026-10-16 :

- **Une valeur saisie fait autorité.** Un limite saisi à la main n'est plus réécrit ni par le sens,
  ni par TP/SL, ni par le déclencheur ; vider le champ rend la main au prix dérivé. Au marché
  il n'y a pas de saisie : le champ est désactivé et le limite est la borne de glissement
  (c'est ce qui tranche l'ancienne question de la bascule « Market trigger »).
- **Le déclencheur n'est jamais réécrit** par un changement de sens (il l'était depuis le limite :
  81000 devenait 80838) ; c'est le limite qui se recalcule.
- **On ne pré-remplit que ce qui a une valeur sûre.** Un ordre limite reçoit le prix du marché
  (une fois par actif). Un ordre déclencheur ne reçoit **rien** : son côté du marché dépend de
  TP/SL et du sens, un pourcentage de départ serait inventé, et un déclencheur au prix exact du
  marché se déclenche tout de suite ou est refusé. Le marché reste affiché en repère. Passer de
  limite à déclencheur (ou l'inverse) **vide les deux champs** : le prix saisi pour l'un n'a pas de
  sens pour l'autre.
- **En modification**, l'ordre est montré tel qu'il est : son limite réel tant que le déclencheur,
  le type et TP/SL sont ceux de l'ordre — y compris quand on **remet** le déclencheur à sa valeur
  d'origine après l'avoir changé. Dès qu'ils changent, le limite suit.
- **Un prix manquant bloque l'envoi.** Avec une taille valable, un limite ou un déclencheur vide
  laissait le bouton actif et partait avec `limitPx: "NaN"` (`roundPrice(NaN)` rend la chaîne
  `"NaN"`, truthy) ; c'est le serveur qui refusait. `orderPricesReady` le bloque avant.

**Deux régressions attrapées avant de committer.** Le premier garde de modification coupait _tout_
recalcul, y compris le suivi du limite quand on change le déclencheur (mesuré : il restait à 80000
après un déclencheur à 82000). Le deuxième ne rendait pas le limite d'origine quand le
déclencheur revenait à sa valeur (2327,5 au lieu de 2300). Chacune a son test et sa mutation.

**La modale « Add protective order » avait un écart fixe de 0,1 %** entre le déclencheur et le
limite de l'ordre de clôture, quel que soit le type et même avec « Market execution » coché
(`buildProtectiveOrderDetails`, `TRIGGER_EXEC_OFFSET`). Relevé le 2026-10-18 en relisant ce que
j'avais affirmé du mobile : « le formulaire envoie déjà 10 % au marché » n'était vrai que du
formulaire principal. **Ce que cela coûtait dépend du type** : au marché, rien — l'exchange ignore
`p` (point 1) ; en exécution **limite**, un plancher trop serré, le cas que la doc officielle donne
pour rester en attente dans un gap. La première version de cette note disait que 0,1 % exposait un
SL au marché à ne pas s'exécuter : **c'était faux**, l'historique du compte le réfutait déjà.
Corrigé : au marché la modale envoie la borne de l'exchange (`marketTriggerBound`), en exécution
limite 5 % (SL) ou 1,5 % (TP). Les écarts vivent dans `core/utils/limit-spread.util.ts`, partagés
par les deux chemins. Mesuré par les tests (`protective-order.utils.spec.ts`), **pas dans le
navigateur ni sur l'exchange** : la modale n'affiche pas le limite, l'ordre n'est construit qu'à
l'envoi, et les ordres réels du 2026-10-18 ont tous été posés par le formulaire principal, pas par
cette modale.

**Le formulaire avertit d'un Stop Loss limite au limite trop serré** (`isStopLimitTight`,
`stopLimitWarning`) : sous **1 %** du déclencheur, le texte « Limit is only 0.00% from the trigger:
this stop may trigger without filling and leave the position open » apparaît sous « Market trigger ».
Un **avertissement, pas un blocage** : le cas est légitime à tester, et c'est ainsi qu'il a été
mesuré. Décidé le 2026-10-18 après le Stop Limit ETH resté 826 s au carnet (point 1 de « À éprouver
en réel »). Le seuil de 1 % est un **choix large**, pas une mesure : un cas, un seul. Pas de
message pour un Take Profit limite (un plancher serré garde le prix visé et ne laisse pas la
position sans protection), ni pour un déclencheur au marché (l'exchange ignore `p`), ni pour un
limite du mauvais côté (déjà bloqué). Couvert par des tests et des mutations, et **mesuré dans le
navigateur le 2026-10-18** sur ETH, à 360 px : le texte s'affiche sur deux lignes dans la colonne
(304 px, de 28 à 332), sans défilement horizontal ; contraste **8,68:1 en sombre**
(`rgb(224, 181, 43)` sur `rgb(29, 29, 29)`) et **5,43:1 en clair** (`#856500` sur `rgb(254, 255, 255)`),
la couleur étant `--ion-color-warning-shade`, la variante prévue pour du texte (`docs/theming.md`).
Absent avec le limite par défaut (« -5.00% from trigger »), absent avec « Market trigger »
(où le libellé lit « -10.00% from trigger (exchange bound) »).

**Changer d'actif repart du marché du nouvel actif.** Prix limite, déclencheur et taille saisis
concernaient l'actif précédent : un stop vendeur à 80080 survivait sur un ETH à 2414 (mesuré le
2026-10-16). En création, ils sont remis à zéro puis pré-remplis selon la règle ci-dessus — limite
au prix du marché pour un ordre limite, taille de 10 $ — dès que le prix **et** les décimales du
marché sont arrivés. Mesuré sur BTC, ETH, `xyz:BRENTOIL` et kPEPE.

**Le câblage du composant est couvert depuis le 2026-10-18** (`order-form.component.spec.ts`, 12 tests,
gabarit vidé et services doublés) : dérivation du limite, limite saisi qui fait autorité, vidage des
champs au changement de type ou d'actif, retour au limite d'origine en modification. Éprouvé par
mutation : cinq retraits dans le composant, chacun fait tomber au moins un test (le premier essai du
vidage au changement de type survivait — le test passait par une autre voie, il a été réécrit).
⚠️ Ce que le spec ne voit pas : le gabarit (rendu, classes rouges, bouton), mesuré dans le navigateur. ⚠️ Un limite
saisi à la main **reste** quand on change le sens : il peut alors se trouver du mauvais côté du
déclencheur (limite sous le déclencheur pour un achat). Refermé le 2026-10-18 : `isLimitOnWrongSide`
bloque l'envoi (bouton et `submit()`), et la ligne « % from trigger » passe en rouge. Mesuré sur un
stop vendeur BTC, déclencheur 81000 : limite à 82000 → rouge (6,20:1 en clair, 6,11:1 en sombre,
360 px sans débordement), bouton désactivé ; limite à 80000 → plus de rouge, bouton actif. Égal au
déclencheur reste permis.

**Un stop déclenché resté au carnet se voit dans la liste des ordres** (`stuck-triggered-order.util.ts`,
2026-10-18). Rien ne le disait : le badge « Trigger » n'apparaît que si `isTrigger` est vrai, et il vaut
**faux** pour cet ordre, qui ressemblait à un ordre limite de vente ordinaire (`Stop Limit`, `Gtc`,
`Reduce`) ; la ligne « Status » du détail vient d'un appel séparé et n'est pas garantie de dire
« triggered » (non lu en réel : sur un ordre au repos elle dirait vraisemblablement `open`). La liste
affiche maintenant un badge rouge **Triggered** et une phrase (« Triggered, but this order is still
resting unfilled: the position is not protected by it. »), le détail une bannière qui nomme le
limite. Même prédicat que le bot, strict (reduce-only, `isTrigger: false`, `triggerCondition:
"Triggered"`). Mesuré dans le navigateur à 360 px, **avec des données de test locales** (la réponse de
`frontendOpenOrders` interceptée dans la page ; rien n'a été envoyé) : texte rouge 6,11:1 en sombre et
6,20:1 en clair, badge 7,61:1 et 6,21:1, aucun défilement horizontal. ⚠️ Pas vu sur un vrai ordre
resté au carnet.

**Un ordre resté partiellement exécuté ne se dit plus « unfilled »** (2026-10-19). `sz` est la part
restante et `origSz` la taille posée ; un ordre limite peut être exécuté en partie, et la phrase
fixe « still resting unfilled » devenait fausse. `describeStuckTriggered` (même fichier) la remplace
par « Triggered, 0.9 of 1.5 already filled, but 0.6 is still resting: the position is not protected
by it. » (le détail y ajoute le limite). La soustraction est exacte (chaînes décimales, pas de
flottant) ; des tailles illisibles ou qui se contredisent (`sz` > `origSz`) ne font rien deviner :
l'ordre est décrit comme reçu. Le bot écrit la même chose dans son journal (`describeStuckTriggeredOrder`,
`nest-trading-bot`). ⚠️ **La forme d'un ordre resté _partiellement_ exécuté n'est pas mesurée** : tous
ceux relevés le 2026-10-18 étaient entiers, `sz` et `origSz` sont lus du type.

Mesuré dans le navigateur le 2026-10-19, à 360 px, **avec des données de test locales** (les réponses
de `frontendOpenOrders` et de `orders/open/{oid}` interceptées dans la page ; rien n'a été envoyé) : un
ordre entier, deux partiels (0,9 sur 1,5 ; 0,0014 sur 0,0044) et un ordre limite ordinaire. Liste : trois
lignes pour les trois phrases, rouge 6,11:1 en sombre et 6,20:1 en clair, aucun défilement horizontal ;
détail : quatre lignes pour la phrase partielle avec son limite, mêmes contrastes, aucun défilement
horizontal. Le contraste est celui d'avant, ce qui est attendu : couleur et graisse n'ont pas changé.
⚠️ Toujours pas vu sur un vrai ordre resté partiellement exécuté.

## Le formulaire d'ordre lisait la grille d'un autre marché — corrigé (2026-10-19)

`order-form.component.ts` cherchait le marché de la paire par
`universe.find((m) => m.name === coin || coin.includes(m.name))`, pour en tirer `szDecimals` et
`maxLeverage`. La correspondance par **sous-chaîne** renvoyait le premier nom contenu dans celui
cherché : un marché dont le nom en contient un autre, listé avant lui, recevait les données de
celui-là.

**Mesuré** en rejouant cette règle, telle qu'écrite, sur les 544 perps réels (`allPerpMetas`, 11 dex,
lecture publique le 2026-10-19) : **38 marchés** reçoivent les données d'un autre, et **36** d'entre
eux avec un `szDecimals` ou un `maxLeverage` différent. Exemples : `ETHFI` reçoit celles d'`ETH`
(`szDecimals` 4 au lieu de 1, levier maximal 25 au lieu de 5), `PEOPLE` celles d'`OP` (1 au lieu de 0,
levier 5 au lieu de 3), `HBAR` celles d'`AR` (2 au lieu de 0), `POPCAT` celles d'`OP`, `NEIROETH` celles
d'`ETH`. Ce n'était pas qu'un affichage : `buildOrderDetails()` arrondit avec cette grille
(`roundSize` et `roundPrice` **arrondissent**, ils ne tronquent pas), donc ce qui partait au gateway était
déplacé. Calculé avec le code exact : `MAVIA` (reçoit `MAV`, 0 décimale au lieu de 1) — une taille saisie à
12,5 partait à **13** ; `ETHFI` — une limite saisie à 0,52345 partait à **0,52**. Même grille pour les
tailles des ordres protecteurs liés et pour la clôture d'une position.

**Branche spot, mesurée aussi** (`spotMeta`, 334 paires) : le nom d'affichage `BASE/QUOTE` n'égale jamais
un nom de jeton, seule la sous-chaîne jouait, sur les jetons dans l'ordre de leur index — **les 334 paires**
recevaient le mauvais jeton (USDC, `szDecimals` 8, pour 317 d'entre elles). Masqué aujourd'hui : l'envoi
d'un ordre spot depuis ce formulaire est déjà bloqué (« the price check is not available for spot markets
yet »).

**Corrigé.** `HyperliquidMarketService.getMarketMeta(coin)` lit la grille par égalité **exacte**
(`market-meta.util.ts`) : un perp dans la méta de son dex (`hlPerpDexOf`), une paire spot par son nom de
protocole puis son jeton de **base**, et refuse un nom que `hlMarketKind` ne classe pas. Un seul résultat,
ou une erreur typée (`invalid-name`, `not-found`, `ambiguous`, `unreadable`) — jamais un voisin ni un repli.
Le formulaire en tire un état (`market-meta-state.util.ts`) qui **bloque l'envoi**, et `submit()` lui-même,
tant que la grille n'est pas celle du marché : en cours de lecture (sans bandeau, c'est un état de quelques
instants), introuvable (« The size and price grid of "X" could not be read (…), so placing an order is
disabled », sans réessai), ou méta qui ne charge pas (avec **Retry**). Une réponse qui arrive après un
changement d'actif est ignorée, et le levier de l'actif précédent ne lui survit plus. Les `subscribe` n'avaient
pas de callback d'erreur : `szDecimals` gardait le défaut `3` ou la valeur de l'actif d'avant, sans rien dire.

Éprouvé : les 12 marchés mesurés (valeurs de l'API recopiées), un extrait de `spotMeta`, le service sur ses
requêtes, le composant (grille d'ETHFI et de MAVIA, envoi bloqué, réessai, réponse périmée, levier) et vingt
mutations, toutes attrapées.

**Vu dans le navigateur le 2026-10-19, session authentifiée, à 360 px, dans les deux thèmes, sur le vrai
formulaire ouvert sur `ETHFI`** (rien n'a été envoyé : le bouton n'a pas été cliqué). Grille réelle : `szDecimals`
1, levier maximal 5 (« Cross · 5x / 5x », 25x avec l'ancien code), limite pré-remplie à **0,67296** (0,67 avec la
grille d'`ETH`), et `buildOrderDetails()` donnerait `limitPx` 0,67296 et `sz` **14,9**. Marché introuvable
(réponse de méta interceptée, sans `ETHFI`) : état `missing`, bandeau avec la raison, bouton désactivé, pas de
Retry. Méta qui ne charge pas : état `unavailable`, bandeau, **Retry** — qui, cliqué avec la vraie méta, lève le
blocage. Le texte du bandeau tient en trois lignes à 360 px, rouge 6,11:1 en sombre et 6,20:1 en clair, aucun
défilement horizontal, bouton compris. **Le navigateur a trouvé un défaut que les tests n'avaient pas** : après
une lecture réussie, un échec sur le même marché laissait « Cross · 5x / 5x » affiché sous le bandeau qui disait
la grille illisible. Corrigé (le levier et l'état « connue » sont retirés sur tout échec), avec un test qui
tombe sans le correctif, puis revu dans le navigateur.

⚠️ **Ce qui n'est pas établi.** Un ordre n'a pas été envoyé : ce qui partirait vient de `buildOrderDetails()`
lu sur le composant, pas d'une réponse du gateway. ⚠️ `normalizeCoin` met en
majuscules le nom que la liste des ordres passe au formulaire (`kPEPE` devient `KPEPE`) : l'égalité étant
exacte, ces sept marchés en minuscules (`kPEPE`, `kBONK`, `kFLOKI`, `kSHIB`, `kLUNC`, `kNEIRO`, `kDOGS`)
seraient maintenant **refusés bruyamment** par ce chemin, au lieu d'être rattachés en silence à un voisin.
Aucune normalisation n'a été ajoutée ; reste à vérifier si ce chemin peut réellement les fournir.

Le voisin de même nature — « spot » décidé par cinq règles différentes — est traité dans la section suivante.

## « Spot » et le dex d'un marché : une seule règle, celle des types partagés — corrigé (2026-10-19)

« Est-ce un spot ? » et « de quel dex ? » étaient écrits **cinq fois, différemment** : `includes('/')` (liste
des ordres, `getAssetIndex`), `includes('/') || includes('-')` (formulaire, détail), `startsWith('@') ||
includes('/')` (résolution des noms), et deux découpes sur `:` (`parseCoin` du cache, `extractDex` du service de
marché). `hlMarketKind` et `hlPerpDexOf` (`@syldel/hl-shared-types`) sont la règle unique ; le bot l'a adoptée le
même jour (`nest-trading-bot/docs/known-gaps.md`).

**Mesuré** (lectures publiques du 2026-10-19 : 544 perps, 334 paires spot) : sous leur nom **brut** — celui que
l'exchange renvoie dans les ordres et les fills —, `includes('/')` ne reconnaît que **1 paire spot sur 334**
(`PURR/USDC`) ; les 333 autres s'appellent `@N`. Sous leur nom d'affichage (`BASE/QUOTE`) les règles s'accordaient,
ce qui masquait le défaut. Conséquences, par lecture du code : la liste affichait « Long/Short » pour un ordre
spot, `getAssetIndex` envoyait un `@N` dans la branche perp (« Perp asset not found ») donc **l'ordre ne s'annulait
pas depuis l'app**, et le sélecteur de marché s'ouvrait sur l'onglet perp. Les découpes sur `:` concordaient avec
`hlPerpDexOf` sur les 878 noms : pour elles, c'est une consolidation. Aucun perp ni paire spot ne porte de `-` :
l'ancien `includes('-')` était mort, mais un futur perp avec un tiret serait parti avec `isSpotAsset: true`.

**Corrigé.** `core/utils/market-kind.util.ts` : `isSpotMarket(nom)` (= `hlMarketKind === 'spot'`) et
`openOrdersDexOf(nom)` (le dex d'un perp, `''` pour un spot, `null` pour un nom que la règle ne classe pas).
`getAssetIndex` se dispatche sur `hlMarketKind` (spot → `10000 + index`, builder → `100000 + dex × 10000 + index`,
perp natif → son index, **le reste → une erreur**) et résout aussi un `@N`. `parseCoin` et `extractDex` sont
supprimés : le cache **refuse** (console.error) de sélectionner un nom douteux au lieu de le lire sur le dex
principal, la position active du formulaire n'est lue que pour un perp, la liste signale un nom douteux. Pour un
spot, `''` est **documenté** : « Spot open orders are only included with the first perp dex » (doc « Info
endpoint », relue le 2026-10-19). Garde-fou `shared/testing/no-handmade-market-rules.spec.ts` : il lit les sources
et refuse `includes`, `indexOf`, `split` et `startsWith` sur `/`, `-`, `:` ou `@`, avec deux dérogations **à la
ligne** (les deux `normalizeCoin`) et un test qui échoue si une dérogation devient périmée.

Éprouvé : les noms réels (bruts et d'affichage), `getAssetIndex` sur ses trois branches et ses refus (dont
`test:ABC` → 110000, l'exemple de la doc), les noms de paires et leur résolution, le cache, le sélecteur, le
formulaire, et seize mutations, toutes attrapées.

**Vu dans le navigateur le 2026-10-19, session authentifiée, avec des ordres de test interceptés dans la page
(rien n'a été envoyé ni annulé).** Liste : l'ordre brut `@107` s'affiche « HYPE/USDC » avec **Buy** (la doc donne
HYPE = paire 107), `PURR/USDC` Sell, `ETH` Long, `xyz:MU` Short. Détail de l'ordre `@107` : « HYPE/USDC », **BUY**.
`getAssetIndex` sur les vraies méta, comparé à un calcul indépendant fait depuis `allPerpMetas` et `spotMeta` :
onze cas concordent — `@107` et `HYPE/USDC` → 10107, `PURR/USDC` → 10000, `@1` → 10001, `BTC` → 0, `ETH` → 1,
`ETHFI` → 121, `xyz:XYZ100` → 110000 — et `:BTC`, le nom vide et `@99999` échouent avec leur raison.

⚠️ **Ce qui n'est pas établi.** L'**annulation** d'un ordre spot `@N` n'a pas été exécutée : ce qui est vu est
l'identifiant d'actif qu'elle enverrait, pas la réponse du gateway. ⚠️ Les deux `normalizeCoin` (majuscules, coupe après
`-` ou `:`) restent, dérogés dans le garde-fou : ils écrasent la casse de `kPEPE`, à reprendre à part en résolvant
le nom contre la méta. ⚠️ Les **outcomes** (`#<encodage>`, `+<encodage>`) étaient lus comme des
perps tant que `hl-shared-types` ne les distinguait pas : repris dans la section suivante (types partagés 0.0.28).
⚠️ Des résolutions de noms simultanées (`resolveCoins` sur une liste) lancent
autant de requêtes `spotMeta` identiques que de noms avant la première réponse : le service ne regroupe pas les
requêtes en vol (existant, non corrigé, poids non chiffré).

## Les outcomes (HIP-4) sont nommés pour ce qu'ils sont, et refusés (2026-10-20)

Les types partagés **0.0.28** font rendre `outcome` à `hlMarketKind` pour `#<encodage>` et `+<encodage>` (329
outcomes vivants sur mainnet, `outcomeMeta`, 2026-10-19). Avant, la règle les rangeait parmi les perps, et l'app,
par lecture du code, les traitait mal sans le dire : « Long/Short » dans la liste, « not a valid market name » ou
« not a market name this app can classify » comme motif de refus. L'app **ne négocie pas** les outcomes ; ce qui
est fait est de les **nommer** et de les refuser avec leur vrai motif.

- `isSpotMarket` reste strictement spot. `isPerpMarket` (perp ou perp de builder) et `orderSideLabel(nom, achat)`
  portent le vocabulaire : **Long / Short** pour un perp, **Buy / Sell** pour tout le reste — spot, outcome, nom
  douteux —, dans la liste des ordres et leur détail. Un outcome ne se prend ni long ni court, et `!isSpotMarket`
  l'aurait rangé parmi les perps.
- `getMarketMeta` refuse un outcome par `MarketMetaError('unsupported')`, et le formulaire a un état
  **`unsupported`** : l'envoi est bloqué, avec « "#10" is an outcome market (HIP-4), which this app does not trade,
  so placing an order is disabled » plutôt que « grid could not be read ».
- `getAssetIndex` le refuse avec son nom. L'identifiant d'un outcome existe (`100_000_000 + encodage`, doc « Asset
  IDs ») ; il n'est **pas** calculé, par décision : l'app ne négocie pas ce genre de marché.
- `openOrdersDexOf` rend `null` : où l'exchange renvoie les ordres ouverts d'un outcome n'a **pas été mesuré**
  (⚠️), donc ni dex principal par défaut ni dex deviné. Le cache et la liste le disent (`console.error`).
- **Le formulaire ne demande le prix qu'à un perp.** Trouvé dans le navigateur, pas par les tests : ouvrir le
  formulaire sur `#10` envoyait `activeAssetData`, requête de perps, à laquelle l'API répond **HTTP 500** (mesuré le
  2026-10-20, comme pour un spot), puis affichait « Market data could not be loaded » avec un bouton **Retry** qui ne
  pouvait jamais réussir. Le formulaire écartait seulement le spot ; il écarte maintenant tout non-perp (spot, outcome,
  nom douteux), et le message du contrôle de prix dit « only available for perp markets » au lieu de « spot ». Les
  libellés du formulaire suivent `usesBuySell` (Buy / Sell pour tout non-perp, Long / Short sans actif choisi).
- Un garde-fou source (`no-handmade-market-rules.spec.ts`) interdit de lire un genre par exclusion
  (`!== 'spot'`, `Exclude<HLMarketKind, …>`, `!isSpotMarket(…)`), avec une dérogation à la ligne (la résolution des
  noms d'affichage, où « pas un spot » veut seulement dire « nom rendu tel quel »).

**Un défaut voisin, trouvé en câblant ceci : « Error undefined ».** `extractErrorMessage` lisait `err.status` ;
une `Error` ordinaire — celle que lève `getAssetIndex` avant tout appel — n'en a pas, et le repli rendait
« Error undefined ». Annuler un ordre dont le nom ne se résout pas affichait donc ce texte, sans la cause (et c'était
déjà le cas pour un `@N` avant la section précédente). Corrigé : une `Error` donne son message
(`hl-error.utils.spec.ts`, éprouvé sur le code cassé : il rend bien « Error undefined »).

Éprouvé : tests de chaque branche, mutations (douze attrapées sur treize pour la première série, deux sur deux
pour le formulaire), et `npm run verify` (build compris).

**Vu dans le navigateur le 2026-10-20, session authentifiée, avec des ordres de test interceptés dans la page (aucune
écriture n'est partie : le simulateur bloquait tout appel d'ordre ou d'annulation du gateway, et aucun n'a été
tenté).** Liste : ETH **Long**, `xyz:MU` **Short**, `@107` affiché `HYPE/USDC` **Buy**, `PURR/USDC` **Sell**, `#10`
**Buy**, `+10` **Sell**. `?coin=#10` : le `console.error` « is an outcome market (HIP-4): it has no dex to read the
open orders of, so none is forced » et le seul ordre `#10` filtré. Détail de `#10` : BUY / SELL selon le sens, et
« Cancel Buy order on #10 ? ». **Annulation confirmée : le toast dit « Cannot resolve the asset index of "#10": it is
an outcome market (HIP-4), which this app does not trade or cancel », aucune requête n'est partie après le clic.**
Formulaire d'édition de `#10` : les deux bandeaux, le bouton d'envoi désactivé, **Buy / Sell**, et — une fois
corrigé — plus de requête `activeAssetData` ni de Retry (seule la lecture `collateral-balance` du gateway part, et
il répond `unknown-collateral`, ce qui est son verdict). Contrôles : ETH garde Long / Short, son prix de marché et son
levier ; `@107` garde Buy / Sell et le seul bandeau du contrôle de prix. À 360 px, rien ne déborde (scrollWidth = 360) ; seul le texte change, aucune couleur : pas de vérification de thème.

⚠️ **Ce qui n'est pas établi.**

- Le `console.error` de la liste des ordres pour un marché sans dex (`open-orders.page.ts`) n'a **aucun test** : la
  page n'a pas de spec, et une mutation qui le supprime survit. Il est vu dans le navigateur, pas protégé.
- Ce que le navigateur a vu était **simulé** : les ordres d'outcome viennent d'un simulateur, pas de l'exchange.
  La forme réelle d'un ordre ouvert d'outcome (`coin`, `side`) n'est donc pas établie.
- **Annuler dans l'app un ordre d'outcome posé ailleurs est refusé — décidé le 2026-10-20 : refuser et dire où
  aller.** Le message ajoute « use the Hyperliquid web app for it » (testé unitairement, non revu dans le navigateur
  depuis). L'identifiant (`100_000_000 + encodage`) n'est **pas** calculé : le gateway le transmettrait tel quel
  (`CancelItemDto.asset`, sans borne), mais l'exchange ne l'a jamais reçu de nous, et l'éprouver demande un vrai ordre
  d'outcome sur mainnet. Si des outcomes se négocient un jour à la main, c'est l'occasion de mesurer l'annulation
  avec un petit ordre réel, puis de la permettre. Rappel : l'exchange renvoie-t-il un ordre d'outcome dans la liste que
  l'app interroge ? Non mesuré non plus.
- Les formes de nom et les identifiants viennent des pages « Asset IDs », « Info endpoint », « HIP-4 outcome
  markets » et de la FAQ « Trade outcome looks incorrect », relues le 2026-10-19. **Où les retrouver, ce qui a été
  vérifié et ce qui reste à mesurer pour un futur chantier outcomes :
  `nest-trading-bot/docs/hyperliquid/spot-and-outcomes.md` (2026-10-20).**
- « Spot Balances » (`balances.page.html`) range ses lignes par `balance.token`, alors que l'exemple de la doc montre
  un solde d'outcome (`+1230`) **sans** `token` : deux soldes d'outcome auraient la même clé. Hypothèse tirée d'un
  exemple, non mesurée ; sans effet tant qu'aucun outcome n'est porté.

## Un escalier de take-profit créé dans la modale : le bot le tient (2026-10-20)

Le plan des protections du bot repose le palier exécuté, au même niveau franchi, sur ce qui reste, et
Hyperliquid l'exécute aussitôt : c'était le défaut mesuré le 2026-10-20. Le bot refusait pour cela, quelques heures,
toute paire à plusieurs take-profit ; ce refus est **retiré**. Le plan relit désormais ce qui a été pris dans les
exécutions de l'exchange et ne repose que le reste (`nest-trading-bot/docs/known-gaps.md`, « Le balayage de poussière
lit le résultat de son IOC », puis « Corrigé le 2026-10-20 »). La modale (`sizePercentSumValidator` : « la somme des
`sizePercent` d'un type est au plus 100 ») n'a donc **rien à changer** : un escalier de take-profit ou de stops créé ici
est tenu par le bot.

⚠️ Ce que l'écran ne montre pas, et qui reste du côté du bot : l'état d'un escalier (palier pris, dû, perdu, mode
dégradé faute d'historique) ne se lit que dans le journal du bot (`[PAIR][ladder]`). Si l'app doit un jour l'afficher, ce
serait un champ de plus dans ce que le bot expose — pas un calcul de l'app, qui ne calcule rien.

## Après une écriture, l'écran montre l'ordre qui en résulte (2026-11-15)

La page de détail d'un ordre traitait l'annulation et la modification de deux façons, et la seconde
affichait un état faux.

- **Modifier affichait « canceled » après un succès.** Une modification _remplace_ l'ordre (ancien
  oid `canceled`, nouveau né à la même milliseconde, point 3 ci-dessous), et la page relisait
  l'ancien oid. Un `modify` seul ne rend pas le nouveau (`{"type":"default"}`) ; un `batchModify` le
  rend par entrée (`statuses[0].resting.oid`, mesuré par la route du gateway le 2026-11-09, W4 de
  `nest-trading-bot/docs/hyperliquid/live-check.md`). `HyperliquidGatewayService.modifyOrder` passe
  donc par `/hyperliquid/order/batch-modify` avec une entrée, `readModifyOutcome` lit la réponse, et
  la page passe au nouvel oid en **remplaçant** l'URL : un retour arrière ramène à la liste, pas à
  l'ancien ordre. Sans oid dans la réponse, la page revient à la liste et le dit — on ne cherche pas
  l'ordre en comparant prix et taille, deux ordres identiques rendraient le choix arbitraire.
- **Une modification refusée laissait « open » à l'écran.** Un refus annule souvent l'original
  (mesuré le 2026-10-27 et le 2026-11-09), le formulaire le disait, mais la page ne relisait l'ordre
  qu'après un succès. Elle le relit désormais à la fermeture du formulaire **dès qu'une écriture a eu
  lieu** (`AccountActivityService`), et seulement dans ce cas.
- **Annuler imposait un filtre à la liste.** La navigation passait `?coin=` : mesuré le 2026-11-15,
  une liste ouverte sans filtre depuis le menu revenait filtrée sur le marché de l'ordre annulé.
  L'annulation revient désormais à la liste **telle qu'on l'a laissée** (retour dans la pile Ionic),
  et la liste s'y relit.

Éprouvé dans le navigateur **sans aucune écriture**, en appelant la page avec des issues simulées sur
les ordres réels du compte : retour à la liste sans filtre, passage au nouvel oid (URL remplacée,
statut `open` relu), retour à la liste sans oid, et une relecture de l'ordre à la fermeture du
formulaire après une écriture signalée, aucune sans. La modification réelle a été éprouvée
ensuite : point 17 ci-dessous.

## À éprouver en réel : ce qu'aucun double ne peut établir

Ces points ne se tranchent ni par la lecture du code ni dans le navigateur : il faut un
ordre réel (ou testnet), de petite taille. Ils sont écrits ici pour ne pas être oubliés le
jour où l'argent réel entre en jeu, et non pour être supposés connus.

1. **✅ `p` d'un ordre déclencheur « au marché » : ignoré par l'exchange.** Le champ est
   obligatoire dans le format d'ordre, et la doc officielle ne dit pas s'il est appliqué ; elle dit
   que les TP/SL au marché ont une tolérance de glissement de **10 %** par défaut. Le gateway
   envoyait `p = triggerPx`, et on craignait qu'un SL vendeur ainsi posé reste en attente dans un
   gap. **Mesuré le 2026-10-18 : `p` est ignoré.** À son déclenchement, l'exchange recrée l'ordre
   avec sa propre borne, **déclencheur × 0,9 pour une vente, × 1,1 pour un achat**, quel que soit
   le `p` posé.

   _La mesure_ : `historicalOrders` du compte de test (une requête publique, 1616 ordres) donne,
   pour chaque ordre déclenché, deux lignes de même `oid` — `triggered` (tel que posé) et `filled`
   (l'ordre exécuté). Sur les **26 ordres au marché déclenchés** du compte (stops et take-profits,
   BTC et SOL, achats et ventes, avril à octobre 2026), `p` valait le déclencheur pour 23, +8 %
   pour un, 10 % pour les deux du jour ; la ligne `filled` porte **toujours** la borne de 10 %. Les
   `73744` du jour, d'abord pris pour un écart inexpliqué, s'expliquent ainsi : ce n'est pas notre
   `p` + 1, c'est la borne de l'exchange.

   _L'arrondi_ de cette borne, déduit de ces 26 ordres : un achat **tronqué**, une vente
   **tronquée puis relevée d'un tick**, y compris quand le produit tombe juste (78130 × 0,9 =
   70317 exactement, il écrit 70318 ; 79960 × 1,1 = 87956 exactement, il écrit 87956).
   `marketTriggerBound` le reproduit sur les 26. ⚠️ **Déduit, pas documenté** : la raison du tick
   de plus pour une vente est inconnue, les deux produits exacts sont des entiers BTC, et une
   première explication (de l'arithmétique flottante) était fausse. Sans conséquence aujourd'hui,
   `p` étant ignoré.

   _Ce que cela change_ : le `p = triggerPx` du gateway n'avait **pas** le défaut craint, pour un
   déclencheur au marché. Le gateway envoie désormais la borne de l'exchange (changement sans effet
   sur l'exécution : il aligne ce qu'on pose sur ce qui sera exécuté). Ce que j'avais présenté
   comme un défaut possible, puis comme une correction, n'en était pas un.

   _Un ordre réel, le 2026-10-18_ (mainnet, 0,00014 puis 0,00015 BTC ≈ 11,5 $, levier cross 1x,
   coût total ≈ 0,035 $ ; lu par `frontendOpenOrders`, `historicalOrders` et `userFills`, requêtes
   publiques), posé **depuis le formulaire d'ordre du mobile** (pas par le gateway ni par la modale
   de protection) :
   - **Accepté**, avec un limite à 10 % du déclencheur : 81561 → 73405, 81764 → 73588, 81937 →
     73743, 81838 → 73654, 81867 → 73680.
   - **Posé sans position ouverte, il est accepté** (reduce-only), puis **actif** quand l'entrée a
     été exécutée : même `oid`, même déclencheur, même limite. Ce que cela donne pour la
     protection d'un ordre parent partiel (point 2) n'est pas établi.
   - **Déclenché et exécuté au marché**, deux fois : 81936.0 pour un déclencheur à 81937 (1 $),
     puis **81810.0 pour 81838 (28 $, 0,034 %)** — premier cas où un stop s'exécute plus bas que
     son déclencheur —, taker, 0,0055 $ de frais, PnL −0,0159 $.
   - **L'exchange retire le reduce-only restant** quand la position se ferme, avec le statut
     `reduceOnlyCanceled`, à la milliseconde du fill.
   - **Ce que cela ne dit pas** : le comportement dans un **gap**. Les deux exécutions se sont
     faites à 1 $ et 28 $ du déclencheur, bien en deçà de la borne de 10 % : elle n'a pas été mise à
     l'épreuve. Elle est celle de la doc de l'exchange.

   _Déclencheurs LIMITES, mesurés le 2026-10-18_ (formulaire du mobile ; `xyz:BRENTOIL`, `io:ANTH` et
   ETH, positions de 10 à 15 $) :
   - **`p` est appliqué.** À chaque déclenchement la ligne `filled` garde le `p` posé — Take Profit
     Limit 105.13, Stop Limit 1807.9, Stop Limit ETH 2377.0 (deux fois), `tif: "Gtc"` — au lieu de la
     borne de l'exchange. Quatre cas, contre 26 pour le marché, où `p` est ignoré : l'ordre posé au
     déclenchement est un ordre limite GTC à ce prix, comme la doc officielle le décrit.
   - **Un limite trop serré reste au carnet.** Stop Limit ETH, limite **égal** au déclencheur (2377.0) :
     posé à 15:36:04, déclenché à 15:36:06, exécuté à 15:49:52, soit **826 secondes plus tard**, en
     maker, à 2377.0, quand le prix est remonté. Pendant ces 13 min 46 s la position était **ouverte et
     sans protection**. Dans l'historique, `triggered` et `filled` n'ont plus le même horodatage : le
     `timestamp` de la ligne `filled` est la création de l'ordre limite, son `statusTimestamp` est
     l'exécution ; partout ailleurs ils étaient identiques. Un cas, pas un temps d'attente typique.
   - **Deuxième cas, même jour** : Stop Limit ETH, limite égal au déclencheur (2365.5), posé à
     16:54:04, déclenché 8,1 s plus tard, **resté au carnet 163,5 s**, exécuté en maker à 2365.5
     (PnL −0,00396 $). Lu dans `frontendOpenOrders` 70 s après le déclenchement : `orderType:
"Stop Limit"`, **`isTrigger: false`**, **`triggerPx: "0.0"`**, `triggerCondition: "Triggered"`,
     `limitPx` 2365.5, `tif: "Gtc"`, `reduceOnly: true` ; le marché était alors 0,7 sous le limite.
     Deux cas sur deux où un limite égal au déclencheur est resté au carnet (826 s et 163,5 s).
   - **Un limite à 5 % s'exécute tout de suite**, au meilleur acheteur : Stop Limit `io:ANTH`
     (limite 1807.9, fill **1906.0** pour un déclencheur à 1904.0, en taker, au-dessus de l'entrée) ;
     Stop Limit ETH (limite 2377.0 sous un carnet à 2377.5 : fill 2377.5).
   - **Un Take Profit limite** s'exécute en taker au prix du carnet (106.73 pour un déclencheur à
     106.73) : son plancher à 1,5 % n'a pas joué.

   - **Troisième cas, et la fermeture** : un Stop Limit ETH posé dans l'**interface officielle** avec un
     limite **très au-dessus** du déclencheur (limite 2380, déclencheur 2363.7) est **accepté** par
     l'exchange, déclenché 2,2 s après sa pose, et son ordre est resté au carnet aussi longtemps qu'on
     le voulait. Une vente **reduce-only IOC** passée alors dans notre formulaire a été acceptée,
     exécutée en un fill à 2364.0, et l'ordre resté est passé en **`reduceOnlyCanceled` à la
     milliseconde du fill**, sans jamais être exécuté. Notre formulaire, lui, bloque un limite de
     vente au-dessus du déclencheur (`isLimitOnWrongSide`), voulu. Un quatrième essai (entrée à
     2366.4, stop à 2365.9) n'a laissé l'ordre au carnet que 6,5 s : l'attente dépend du prix.

   _Le déclencheur se compare au mark price_, pas au carnet. Sur `io:ANTH` : mark 1904.2, milieu du
   carnet 1904.65, oracle 1902.4. Un stop remonté à 1904.0 (par le chart de l'interface officielle) a
   été **déclenché 1,2 s après sa pose**, alors que le carnet affichait un acheteur à 1906 : le mark
   était sous le déclencheur. Sur ETH, mark et carnet ne diffèrent que de 0,1 $. C'est le seul cas
   net pour le **point 5** : un déclencheur du mauvais côté du mark, posé par modification, est
   **accepté et déclenché dans la seconde**, pas refusé. Notre formulaire, lui, le bloque (il compare
   au `markPx` lu à l'ouverture, qu'il ne rafraîchit pas : un prix qui bouge pendant la saisie
   bloque le bouton, comme sur ETH le 2026-10-18).

   _HIP-3_ (`xyz`, `io`) : mêmes mécanismes que BTC — reduce-only accepté sans position, retiré à la
   fermeture avec `reduceOnlyCanceled`, modification = annulation + nouvel `oid`. `io:ANTH` est
   `onlyIsolated` (`strictIsolated`, levier max 6) : la position est isolated 6x, avec un
   `rawUsd` négatif. Une entrée ALO y a été exécutée en **deux fills** (0,001 puis 0,007, à 15 s
   d'écart) ; un ALO au prix de l'ask est refusé avec le statut **`badAloPxRejected`**.

   _Sources lues le 2026-10-18, et ce qu'elles valent_ (lues par un outil qui en rend un résumé,
   pas ligne à ligne ; **elles ne tranchaient rien**, c'est l'historique du compte qui a tranché) :
   - **SDK Python officiel, `examples/basic_tpsl.py`** : le TP part avec `p = triggerPx`, le SL
     avec un `p` écarté du déclencheur (2500 sous 2600 pour clore un long). Aucun commentaire ne
     dit pourquoi.
   - **SDK Python, `signing.py`** : `p` est écrit pareil pour tous les ordres, `isMarket` vrai ou
     faux. Le SDK ne décide rien ; ni lui ni le SDK Rust communautaire (hypersdk, qui ne place
     aucun ordre déclencheur dans ses exemples) ne documentent l'effet de `p`.
   - **Issue `hyperliquid-python-sdk#97`** : un Take Profit Market exécuté (AAVE) a un `limitPx` de
     320,91 à l'API et de 356,56 dans l'interface, soit 90,0 %. Lue avec la mesure ci-dessus, elle
     s'explique : 320,91 est la borne de l'exchange.

2. **⚠️ TP/SL enfants d'un ordre parent partiellement rempli.** La doc dit que les enfants
   ne sont placés que lorsque le parent est entièrement rempli ; annuler un parent partiel
   annule les enfants. Une position peut donc rester sans protection. À éprouver sur la
   section « protective » du formulaire.
3. **Le `limitPx` renvoyé par Hyperliquid pour un ordre déclencheur existant.** La modification
   (garde de `limitFromTrigger`) avait été mesurée sur des ordres factices de forme devinée.

   _Mesuré le 2026-10-18_ (Stop Market BTC et Take Profit Limit réels) :
   - **Au repos, l'exchange rend le `p` envoyé**, avec « .0 » en plus (`73405.0`, `73588.0`,
     `73743.0`, `73654.0`), y compris après une modification. Idem pour un Take Profit **limite**
     posé avec un limite à 1,5 % (81959 → `80730.0`), sa forme réelle étant `orderType: "Take
Profit Limit"`, `triggerCondition: "Price above 81959"`.
   - **Une modification est une annulation suivie d'un nouvel ordre** : l'ancien `oid` passe
     `canceled` à l'instant où le nouveau est créé (quatre fois mesuré, dont une fois depuis le
     chart de l'interface officielle, qui déplace le déclencheur **sans recalculer le limite** :
     81959 → 81973, limite resté à 80730 ; le formulaire du mobile, lui, le recalcule tant qu'il
     n'a pas été saisi).
   - **Au déclenchement, l'historique garde deux lignes** pour l'`oid` : `triggered` (tel que posé)
     et `filled` (`triggerCondition: "Triggered"`, `sz: 0.0`, `tif: "Gtc"`), dont le `limitPx` est
     **la borne de l'exchange**, pas le `p` posé (point 1). Le `limitPx` d'un ordre **déclenché**
     n'est donc pas celui qu'on a envoyé : le bot lit le déclencheur, pas la limite.
   - **L'interface officielle** affiche « Market » pour le prix d'un Stop Market, et le `p` pour un
     Take Profit Limit (80 730, valeur d'ordre 12,11 USDC = 0,00015 × 80 730).
   - **Reste à lire** : un Stop Limit / Take Limit **au déclenchement** — le TP limite posé n'a
     pas été déclenché (la position a été fermée par le stop, qui a retiré le TP avec
     `reduceOnlyCanceled`).

4. **Les écarts de limite d'un déclencheur LIMITE (5 % SL, 1,5 % TP).** Des choix argumentés (doc
   officielle, Freqtrade). Le 2026-10-18 a donné **un contre-exemple chiffré** : un limite à 0 %
   est resté 826 s au carnet (point 1), et un limite à 5 % s'est exécuté tout de suite, deux fois.
   Pour le reste : le bon écart d'un SL se lit sur des
   sorties réelles en marché agité, pas dans une doc. Le 10 % d'un déclencheur au marché n'est
   plus de ce point : c'est la borne de l'exchange (point 1).
5. **Déclencheur du mauvais côté du marché.** Le prix de déclenchement est le **mark price** ; un
   déclencheur du mauvais côté est déclenché tout de suite ou refusé — le comportement exact
   n'a pas été observé. Le formulaire ne pré-remplit plus de déclencheur, et `isPriceInvalid`
   **bloque** déjà un déclencheur du mauvais côté du marché (rouge, bouton désactivé) : il ne se
   teste donc pas depuis l'app. Il concerne les chemins sans ce garde — le bot, le gateway appelé
   directement — où le côté est calculé et non saisi. Valeur faible, laissé ouvert.
6. **⚠️ Un IOC au marché rempli en partie** ([market-orders.md](market-orders.md)). On suppose la
   forme `filled: { totalSz < taille demandée }` ; toute autre forme tombe en état inconnu, jamais
   en succès (`market-fill.util.ts`). La mesure : un ordre plus gros que le premier niveau du
   carnet, avec un glissement très faible. **Reportée le 2026-11-12, faute de taille** : sur 18 perps
   peu liquides lus ce soir-là, le meilleur prix portait 300 à 1 000 $ ; ME et GOAT n'en
   portaient que 34 à 42 $ le temps d'une lecture, puis 331 à 1 067 $ une minute plus tard. Avec un
   compte d'environ 22 $, le remplissage partiel ne s'obtient que par hasard. À reprendre avec un
   ordre de quelques centaines de dollars, glissement à 0,05 % ; la confirmation dit d'avance la
   part remplissable (« Fillable within max slippage »).
7. **✅ Le délai de `reduceOnlyCanceled` après une fermeture totale : aucun, trois fois sur trois.**
   Mesuré le 2026-11-12, avec des stops de **taille fixe** : le stop passe `reduceOnlyCanceled` **à
   la même milliseconde** que l'exécution de la fermeture. Sur BTC (0,00015, long) : stop limite
   602705157250 à 12:50:37.020 UTC, stop au marché 602706369092 à 12:52:20.339. Sur ETH (0,0343,
   **short**, le stop est un achat) : Stop Market 602789574942 à 21:57:32.974, fermé par
   `Close › Market` à 100 % depuis le mobile (IOC reduce-only 603225380721, plafond 2 037,4 =
   mid + 1 %, exécuté en une fois à 2 017,3, frais 0,031137 $ = 0,045 % du notionnel, le taux
   affiché). La feuille de fermeture dit « cancels it at once » pour eux, et pour un TP/SL « de
   position » depuis la mesure du point 12.
8. **✅ Une fermeture partielle sous 10 $ : refusée ; une fermeture à 100 % sous 10 $ : acceptée.**
   Mesuré le 2026-11-12, deux refus `minTradeNtlRejected` pour un IOC reduce-only partiel :
   0,00003 BTC (≈ 2,2 $, oid 602702312897) puis 0,00013 BTC (≈ 9,29 $ sur une position de 21,4 $,
   oid 603242720281, 22:31:33.505 UTC), avec le texte « Order must have minimum value of $10.
   asset=0 ». Le second a été envoyé depuis le mobile avec le blocage levé dans le worktree le
   temps d'un envoi, puis remis en place. Le seuil est le minimum ordinaire de 10 $, et le
   blocage de la feuille (`partialCloseRefusal`) évite un refus connu.

   **La fermeture à 100 % d'une position sous 10 $, elle, est acceptée.** Mesuré le 2026-11-12 à
   22:13:50.175 UTC, depuis le mobile (`Close › Market` à 100 %) : un IOC reduce-only de
   0,00001 BTC (≈ 0,71 $, plafond 70 740 = mid − 1 %) a été rempli à 71 459, frais 0,000321 $
   (603233856328). Le minimum ne s'applique donc pas de la même façon à une fermeture qui solde la
   position et à une fermeture partielle. La feuille ne bloque pas le 100 %, à raison.

9. **✅ Un stop au marché sous 10 $ à sa borne, mais pas à son déclencheur : accepté, déclenché,
   exécuté.** Mesuré le 2026-11-12, posé depuis le mobile. Ce matin, un Stop Market de 0,00015 BTC
   (déclencheur 71 510, borne 64 360, 9,65 $ à la borne) avait été **accepté à la pose**
   (602706369092), puis annulé par une fermeture avant tout déclenchement. Le soir, la mesure de
   l'exécution : position 0,00015 BTC, Stop Market reduce-only de **0,00014**, déclencheur 71 498,
   borne 64 349 — **9,01 $ à la borne, 10,01 $ au déclencheur** (603229340180). Posé à 22:04:31,
   `triggered` puis **`filled`** à 22:11:53.173 UTC, en une exécution à 71 493 (10,009 $), frais
   0,004504 $ (0,045 %). Hyperliquid n'a donc **pas jugé le minimum à la borne** au
   déclenchement : `notionalPrice`, qui juge un déclencheur au marché à son déclencheur, est
   cohérent avec lui sur ce cas.

   La mesure prévue (0,00013, ≈ 9,3 $ **au déclencheur**) était mal conçue : le formulaire bloque à
   juste titre un stop sous 10 $ à son déclencheur, c'est ce que l'utilisateur a constaté (« ≈ 9.29
   $ », bouton désactivé), et 0,00014 était le bon cas — sous 10 $ à la borne, au-dessus au
   déclencheur. Un stop sous 10 $ à son déclencheur : refusé au déclenchement, voir le point 13.
   ⚠️ Un seul cas, exécuté 5 $ sous le déclencheur ; un gap qui exécuterait sous
   10 $ de valeur n'est pas mesuré.

10. **✅ Un ordre au marché et ses protections, en réel (2026-11-12).** Achat 0,00015 BTC, plafond
    73 590, exécuté à 72 865 en taker, frais 0,004918 $ (0,045 %, le taux affiché). Avec un Stop
    Loss à 2 % : exécution à 72 969 (12:51:33.072), stop posé **0,89 s** plus tard sur 0,00015 (la
    taille remplie), déclencheur 71 510 = 72 969 × 0,98 — ancré sur le prix moyen obtenu.

11. **✅ Une fermeture LIMITE de toute la position sous 10 $ : acceptée, et exécutée.** Mesuré le
    2026-11-12 depuis le mobile (`Close › Limit`, le blocage du formulaire levé dans le worktree le
    temps d'un envoi) : position 0,00013 BTC, vente reduce-only **ALO** de 0,00013 à 71 422
    (≈ 9,28 $, 603249193381), `open` au carnet à 22:47:53.482 UTC, `filled` en maker à
    22:47:59.073. Avec le point 8 : Hyperliquid exempte du minimum un ordre qui **solde** la
    position, IOC comme limite, pas une fermeture partielle. Le formulaire bloquait ce cas ; il le
    laisse passer depuis (`isBelowOrderMinimum`). ⚠️ Pas mesuré pour un déclencheur, qui reste
    bloqué.

12. **✅ Un TP/SL « de position » est annulé, comme un stop de taille fixe, par une fermeture
    totale.** Mesuré le 2026-11-13 sur un short ETH de 0,008 : un SL de position posé depuis
    l'interface web d'Hyperliquid (le mobile n'en pose pas, il envoie en groupement `na`), Stop
    Market déclenché au-dessus de 2 100, `isPositionTpsl: true`, taille 0 (603932533273), à côté
    d'un Stop Market de taille fixe 0,008 (603925007022). Fermeture par `Close › Market` à 100 %
    depuis le mobile : IOC 603933829890 exécuté à 1 958,4 à 13:10:55.791 UTC, et **les deux**
    stops `reduceOnlyCanceled` à la même milliseconde. La feuille de fermeture disait « should
    cancel it » pour le premier ; elle dit depuis « cancels it at once » pour les deux.

13. **✅ Un stop sous 10 $ à son déclencheur : accepté à la pose, REFUSÉ au déclenchement.**
    Mesuré le 2026-11-13 depuis le mobile, le blocage du formulaire levé dans le worktree pour les
    seuls déclencheurs le temps de la mesure, puis remis en place. Long ETH 0,0056 à 1 975,2 ;
    Stop Market reduce-only de **0,005**, déclencheur 1 972, borne 1 774,9 — **9,86 $ au
    déclencheur** (603956585419). `open` à 13:36:09.860 UTC, puis `triggered` **et**
    `minTradeNtlRejected` à 13:52:35.538, à la même milliseconde : **aucune exécution**, la
    position est restée ouverte, sans ce stop. Un premier essai (603939512856, 9,76 $) avait été
    accepté à la pose, puis annulé par une fermeture manuelle avant tout déclenchement.

    Conséquence : le blocage du formulaire **n'est pas une prudence mais une nécessité**. Hyperliquid
    ne refuse pas ce stop quand on le pose, il le refuse quand il devrait protéger — une défaillance
    muette au pire moment. Avec le point 9 (10,01 $ au déclencheur, exécuté), le minimum se juge
    au déclencheur, comme le fait `notionalPrice`. ⚠️ Un stop posé hors de l'app (interface web)
    n'est pas contrôlé. Les protections posées avec une ouverture ne l'étaient pas non plus (un
    long de 10,05 $ avec un Stop Loss à 2 % posait un stop de 9,85 $ à son déclencheur) : elles le
    sont depuis le même jour (`protectiveMinimumRefusal`, `core/utils/order-minimum.utils.ts`), à
    l'ajout, dans le formulaire et à l'envoi.

14. **✅ Un stop LIMITE se juge aussi à son déclencheur, pas à son prix limite.** Mesuré le
    2026-11-13 depuis le mobile, le blocage du formulaire levé pour les déclencheurs le temps de la
    mesure, puis remis en place. Long ETH 0,006 à 1 965,1 ; Stop Limit reduce-only de **0,0052**,
    déclencheur 1 958, prix limite 1 860,1 — **10,18 $ au déclencheur, 9,67 $ au prix limite**
    (604013908327). `open` à 14:34:31.035 UTC, `triggered` puis **`filled`** à 14:35:48.778, en
    une exécution taker à 1 957 (10,18 $), frais 0,004579 $. Le stop ne couvrait pas toute la
    position (0,0052 sur 0,006) : l'exemption d'une fermeture totale ne joue pas.

    Le formulaire et les protections jugeaient un stop limite à son prix limite, une hypothèse
    jamais mesurée : ils bloquaient à tort ce cas, soit, pour un Stop Loss limite à 5 %, toute
    protection entre 10 et 10,53 $ au déclencheur. Ils le jugent depuis à son déclencheur, comme un
    stop au marché (`notionalPrice`, `triggerOrderValueUsd`). ⚠️ Exécuté aussitôt, en taker : un
    stop limite qui, après un gap, resterait au carnet à son prix limite (sous 10 $) n'est pas
    mesuré.

15. **✅ Les frais taker sortent de la marge isolée, calculée au prix d'entrée.** Mesuré le
    2026-11-13 depuis le mobile, ETH passé en isolé 3x sur l'interface web (le mobile ne change
    pas le mode de marge). Long au marché de 0,0056, exécuté à 1 925,2, frais 0,004851 $
    (604105843891). `clearinghouseState` : `rawUsd` −7,192265, donc une marge isolée de 3,588855 =
    0,0056 × 1 925,2 / 3 (3,593707) − les frais ; `liquidationPx` 1 310,5439139942, que la formule
    de `liquidations.md` redonne avec cette marge à 10⁻¹⁰ près. L'estimation de la confirmation
    prenait `taille × mark / levier`, sans frais, et affichait 1 309,83 : elle prend depuis le prix
    d'entrée estimé et retire les frais au taux du compte (`estimateLiquidation`, `takerRate`).
    Au passage, la relecture de la confirmation a refusé deux fois d'envoyer : le plafond avait
    bougé de 0,27 % et 0,17 % pendant la lecture, au-delà des 0,1 % tolérés.

16. **✅ Le chart relit un ordre posé, modifié ou annulé dès la réponse de `/exchange`.** Depuis
    le 2026-11-15, chaque `place`, `modify` et `cancel` fait relire au chart de watchlist-detail
    ses ordres et fills **à l'instant où la réponse arrive** (voir
    [chart-overlays.md](watchlist/chart-overlays.md#fraîcheur--ce-qui-sert-le-cache-ce-qui-le-passe)).
    On craignait qu'`historicalOrders` serve encore l'état d'avant à ce moment. **Éprouvé en réel
    par le développeur le 2026-11-15** : ordre limite posé depuis Open Orders, modifié, annulé, avec
    un retour au chart après chaque étape — la ligne a suivi à chaque fois, sans rafraîchissement.
    ⚠️ Un constat à l'écran, pas une mesure : aucun délai relevé, une séquence, ni oid ni marché
    notés. Si une ligne reste un jour à l'ancien prix, c'est ce point qu'il faut rouvrir — le bouton
    rafraîchir reste le recours, et le remède serait une seconde relecture après un court délai.

17. **✅ Une modification depuis le mobile mène au nouvel ordre (2026-11-16).** La modification passe
    par un `batchModify` à une entrée, dont la réponse donne le nouvel oid. Éprouvé en réel sur un
    take-profit BTC loin du marché (déclencheur, pas un ordre limite), modifié **deux fois de suite**
    depuis sa page de détail, gateway local : chaque fois le toast « Hyperliquid replaced it with order
    … », la page sur le nouvel oid (`open`, nouveau déclencheur), et dans la pile Ionic aucune page de
    l'ancien ordre derrière elle — l'URL est bien remplacée. L'historique montre la chaîne
    607443428761 → 607450567413 → 607451222390, chaque ancien oid `canceled` à la milliseconde même
    où le suivant naît `open`. Un retour arrière ramène à la liste telle qu'ouverte depuis le chart
    (`?coin=BTC`), sans oid périmé. ⚠️ Jamais mesuré : une modification qui **s'exécute aussitôt**
    (`filled`) ; elle est traitée comme un ordre `order` exécuté, forme supposée identique.

18. **Un ordre posé depuis le mobile est listé dès la relecture qui suit l'écriture** (mesuré une
    fois, le 2026-11-16). La relecture du compte part à l'instant où `/exchange` répond, une seule
    fois ; si le listing suivait avec retard — le bot en a déjà vu un, cause non établie
    (`nest-trading-bot/docs/hyperliquid/live-check.md`, « Le listing … n'est pas un verdict ») —, le
    chart resterait sur l'état d'avant. Mesuré : take-profit BTC posé depuis Open Orders, gateway
    local, et le nouvel ordre présent dès cette relecture — `frontendOpenOrders` à +611 ms de la
    réponse, `historicalOrders` à +1636 ms ; trois relectures forcées à +2, +5 et +15 s n'ont rien
    changé. Aucune relecture supplémentaire n'est donc ajoutée. ⚠️ Une seule mesure, sans passer par
    le gateway du VPS. Piège rencontré en la faisant : dans `historicalOrders`, un ordre rempli ou
    annulé dans la milliseconde de sa pose porte `open` et son état final au **même**
    `statusTimestamp` — laisser gagner `open` comptait 62 ordres ouverts sur un compte qui en avait un.

## Précédent

Le dernier risque refermé — une expression malformée faisant rejeter toute la requête
d'analyse, indicateurs compris — a été reproduit, mesuré et corrigé : voir
[watchlist/chart-overlays.md](watchlist/chart-overlays.md#une-expression-malformée-emportait-tout-le-reste).
Il vaut d'être relu comme exemple : le risque avait été écrit sans être vérifié, et la
vérification a montré qu'il était non seulement réel, mais doublé d'un diagnostic faux
affiché à l'utilisateur.
