# hyperliquid-mobile — notes pour un agent

Application mobile Ionic / Capacitor / Angular (standalone + signals) pour le bot de
trading. Elle ne calcule rien : elle affiche et configure ce que des services maison
exposent. Voir [docs/ecosystem.md](docs/ecosystem.md) avant de supposer qu'une
fonctionnalité appartient à ce dépôt.

## L'exigence, avant tout le reste

**Cette application servira d'outil de trading, avec de l'argent réel.** Un bug silencieux
n'y coûte pas un affichage de travers : il coûte une position prise sur une donnée fausse,
ou pas prise du tout, sans que rien ne le signale. Tout ce qui suit en découle.

- **Aucune défaillance muette.** Si quelque chose ne peut pas être fait, ça doit se voir —
  un repli sur des bougies nues s'annonce, une valeur indéterminée laisse un trou visible
  et non un trait interpolé, une série introuvable n'est pas attribuée au hasard.
- **Toujours pouvoir comprendre ce qui s'est passé.** Un comportement doit être
  reconstituable après coup : d'où vient cette valeur, qui en fait autorité, quelle
  version a écrit ce document. C'est aussi à ça que servent les commentaires de ce dépôt.
- **Anticiper plutôt que subir.** Quand deux sources peuvent diverger, le dire dans le
  code et choisir laquelle fait autorité — le catalogue du bot, jamais le paquet compilé ;
  le verdict du serveur, jamais la validation locale.
- **Pas d'approximation par confort.** Une incertitude se résout ou se documente
  explicitement (voir les `⚠️` dans `docs/`), elle ne se laisse pas dormir.

En cas de doute, préférer l'option qui échoue **bruyamment et tôt**. Voir
[docs/conventions.md](docs/conventions.md#exigence-de-robustesse).

## Cette app est l'écran où le backtest se lit

La raison d'être du bot est d'automatiser des stratégies **pertinentes** — et c'est le
backtesting qui rend ce mot vérifiable plutôt que déclaratif. **Appliquer une stratégie
sans l'avoir éprouvée n'est pas une option.** La doctrine complète — ce qu'un backtest doit
rapporter, les régimes de marché à couvrir, le piège de sur-ajustement — vit côté bot, qui
calcule : `nest-trading-bot/CLAUDE.md`, « Le backtesting : ce qui rend une stratégie
pertinente ».

Ce qui en découle **ici**, où le chiffre est lu plutôt que produit :

- **un backtest brut ne se présente pas comme un résultat.** `buildBacktestReport` ne compte
  **ni frais, ni funding, ni slippage** — son en-tête le dit, et les frais ont valu jusqu'à
  27 points de rendement sur 302 trades (mesuré le 2026-10-07). Un écran qui affiche
  `+15 %` sans dire de quoi ce chiffre est net invite à une décision fausse ;
- **un chiffre qui porte le nom d'une métrique connue doit en être une.** `Max drawdown` a
  affiché pendant des mois `sommet − valeur` sur une courbe de points cumulés, sans
  dénominateur — mesuré, « 562 » là où le drawdown réel était de 76,67 %. Corrigé dans les
  types partagés 0.26.0 le 2026-10-08, et c'est la validation d'une lecture, pas un
  ajustement d'affichage ;
- un rendement seul ne permet pas de décider. Drawdown, exposition, régularité entre
  périodes, taux de réussite : ce sont eux qui distinguent deux stratégies au même
  rendement. Les afficher est un travail d'interface autant que de calcul ;
- **l'achat-conservation est la référence à battre.** Si l'écran ne la montre pas, il laisse
  croire qu'un rendement positif est un succès.

⚠️ Le troisième point est tenu depuis le 2026-10-08 ; les autres non. Drawdown, exposition,
régularité et taux de réussite ne sont pas affichés, et rien ne dit de quoi un rendement est
net. C'est de la dette connue, pas un acquis : voir [docs/roadmap.md](docs/roadmap.md) et
`nest-trading-bot/docs/known-gaps.md`.

## Stade du projet : casser est permis, et souvent souhaitable

**Aujourd'hui, un seul utilisateur — le développeur —, aucune stratégie activée sur le bot,
aucun argent réel en jeu.** C'est précisément la fenêtre où la qualité se construit à bas
coût, avant que l'exigence ci-dessus ne s'applique à de vrais ordres.

- **Les changements cassants sont acceptés**, côté app comme côté bot ou types partagés :
  modèle, format de stockage, contrat d'API, structure de composant. Si casser rend le
  système plus robuste, plus fiable ou plus évolutif, c'est la voie attendue.
- **Proposer la meilleure option, pas le compromis qui préserve l'existant.** Une
  compatibilité ascendante n'a pas encore d'enjeu réel ; la conserver par réflexe fige des
  défauts qu'on paiera plus tard, avec de l'argent réel.
- **Casser n'est jamais casser en silence.** Un ancien format abandonné se migre
  explicitement ou se refuse bruyamment ; une donnée de l'utilisateur ne disparaît pas sans
  que ce soit dit. Un changement qui traverse les trois dépôts se coordonne (tag de
  `trading-shared-types`, bot, app) au lieu de s'éviter.

Voir [docs/conventions.md](docs/conventions.md#casser-plutôt-que-compromettre).

## Comment travailler ici

L'exigence ci-dessus porte sur le produit ; celle-ci porte sur la façon de l'obtenir.

**Proposer avant d'agir.** Sur un chantier un peu large, l'attendu est une analyse, des
questions s'il en reste, une recommandation — puis on attend le feu vert. Pas un
enchaînement d'étapes décidées seul.

**Vérifier plutôt que supposer.** Le navigateur interne, les vraies routes du bot, le DOM
plutôt qu'une capture d'écran. Annoncer qu'une chose fonctionne engage : ça doit avoir été
mesuré, et le rapport doit dire comment.

**Dire ce qui n'a pas été vérifié.** Une incertitude s'écrit là où quelqu'un la lira au bon
moment — un `⚠️` dans `docs/`, un commentaire à l'endroit concerné. Le dernier risque écrit
de cette façon s'est révélé réel _et_ doublé d'un diagnostic faux affiché à l'utilisateur
(voir [docs/roadmap.md](docs/roadmap.md#risques-identifiés)).

**Rester critique.** Y compris envers une proposition de l'utilisateur, envers le code déjà
écrit, et envers son propre travail des tours précédents. Un désaccord argumenté est plus
utile qu'un acquiescement.

**S'appuyer sur ce qui existe.** Devant une décision incertaine, chercher comment les bots et
plateformes établis la traitent (Freqtrade pour le bot, TradingView pour l'affichage) avant de
proposer, et le citer. Un standard oriente, il ne décide pas ; un écart se justifie. Ce qui a
déjà été confronté côté bot : `nest-trading-bot/docs/trading/professional-practices.md`.

## Règles qui coûtent cher si on les ignore

**Ne jamais committer, tagger ou pousser sans demande explicite**, dans aucun des trois
dépôts. Proposer un message de commit conventionnel et laisser l'utilisateur l'exécuter
est le mode de fonctionnement établi.

**Ne jamais importer un catalogue du paquet partagé comme valeur.** Indicateurs,
transformations, fonctions et grammaire du rule-builder se lisent depuis
`GET /exchanges/meta` via `BotService`, jamais depuis `INDICATOR_REGISTRY`,
`AVAILABLE_*_METADATA`, `RULE_BUILDER_GRAMMAR` ni les helpers qui complètent des
paramètres depuis `INDICATOR_DEFAULTS`. Un build mobile qui dérive sa propre liste peut
diverger en silence d'un bot plus récent. `src/app/shared/testing/no-catalog-imports.spec.ts`
garde la règle et porte la liste exacte ; un `import type` est libre (effacé à la
compilation). Voir [docs/ecosystem.md](docs/ecosystem.md#le-catalogue-vient-du-serveur).

**Ne jamais éditer `package.json("version")` à la main**, ici ou dans
`trading-shared-types` — l'utilisateur lance `npm version` lui-même. La dépendance aux
types partagés est épinglée par tag git (`github:Syldel/trading-shared-types#vX.Y.Z`) :
la faire évoluer est une décision, pas un détail d'implémentation.

**L'Angular moderne est la norme ; l'ancien est du code de compatibilité.** Angular 21,
zoneless, tout standalone — relevé le 2026-09-29 : 164 `inject()` contre 2 constructeurs,
188 `@if` et zéro `*ngIf`, aucun `@Input()` dans le code applicatif, zéro `NgModule`.
Introduire l'une de ces formes anciennes est donc une **régression**, pas un choix de
style. Quelle primitive prendre selon ce qu'on écrit, et ce qui reste légitimement en
ancien : [docs/angular.md](docs/angular.md). ⚠️ Un ordre ne passe **jamais** par un
`resource()` — Angular y annule les chargements en vol, et une écriture annulée est un
ordre dont on ignore l'état.

**Toute modification visuelle se vérifie dans les deux thèmes.** Une couleur, un fond, une
`opacity` ou une taille de texte qui change se contrôle en clair **et** en sombre avant
d'être proposée : le navigateur émule les deux schémas, la vérification ne se délègue pas
à l'utilisateur. Et le contraste se **calcule**, il ne s'apprécie pas à l'œil — seuil
4,5:1 pour du texte courant, 3:1 au-delà de 24 px (ou 18,7 px en gras), les contrôles
désactivés exemptés. Deux raisons concrètes : le thème sombre est resté **à moitié
appliqué** pendant des mois sans que rien ne le signale, et une correction qui répare un
thème peut dégrader l'autre — mesuré. Seuils, pièges de mesure et chiffres de référence :
[docs/theming.md](docs/theming.md).

**Vérifier l'état réel avant de ré-implémenter.** Lire le fichier et l'historique git
avant de refaire une étape supposée manquante.

## Commandes

```bash
npm start                 # ng serve sur http://localhost:4200
npm test                  # vitest via @angular/build:unit-test
npx ng test --watch=false # une seule passe
npx ng build              # build de production
npx tsc -p tsconfig.app.json --noEmit
```

Les fins de ligne sont **LF partout**, imposées par `.gitattributes` et non par la
config locale de git : le MacBook, le PC et une CI doivent se comporter à l'identique.
`npm run format` peut donc réécrire tout `src/` sans bruit — le piège où
`core.autocrlf=true` et `endOfLine: 'lf'` se repassaient les mêmes fichiers n'existe
plus. Si un diff de fins de ligne réapparaît, vérifier `git config core.autocrlf`
(doit valoir `false`) avant de chercher ailleurs. Voir
[docs/conventions.md](docs/conventions.md#formatage).

## Documentation

| Fichier                                                              | Contenu                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/ecosystem.md](docs/ecosystem.md)                               | les dépôts, qui possède quoi, la règle du catalogue  |
| [docs/strategies/overview.md](docs/strategies/overview.md)           | le rule-builder de bout en bout                      |
| [docs/strategies/rule-model.md](docs/strategies/rule-model.md)       | l'arbre de règles, les chemins, les anomalies        |
| [docs/watchlist/chart-overlays.md](docs/watchlist/chart-overlays.md) | les couches du chart et les règles de pane           |
| [docs/conventions.md](docs/conventions.md)                           | exigence, usages, tests, pièges d'outillage          |
| [docs/angular.md](docs/angular.md)                                   | quelle primitive choisir, et l'état réel du dépôt    |
| [docs/theming.md](docs/theming.md)                                   | les deux thèmes, les paliers, les contrastes mesurés |
| [docs/roadmap.md](docs/roadmap.md)                                   | ce qui est remis à plus tard, et pourquoi            |

## Où vivent les choses

- `src/app/core/` — auth, storage, intercepteurs, et les services d'accès aux API
  (`BotService`, `UserService`, `ConfigService`)
- `src/app/features/secure/strategies/` — le rule-builder : `domain/` (logique pure et
  testée), `models/`, `services/`, `components/`
- `src/app/features/secure/watchlist/` — le chart et ses surcouches (voir
  [docs/watchlist/chart-overlays.md](docs/watchlist/chart-overlays.md), notamment les
  règles de pane de lightweight-charts)
- `src/app/features/secure/bot-strategies/` — la configuration des paires du bot
- `src/app/shared/` — composants transverses et outillage de test

Alias de chemins disponibles : `@auth/*`, `@api/*`, `@storage/*`, `@models/*`,
`@services/*`, `@pipes/*`, `@utils/*`, `@shared/*`, `@features/*`. Entre deux features,
l'usage établi reste le chemin relatif (`../../../strategies/...`).

## Conventions de code

**Le code s'écrit en anglais, seuls les commentaires sont en français.** Identifiants,
**libellés de `describe` et `it`**, messages de journal et d'erreur, libellés d'interface,
messages de commit : anglais. Commentaires, blocs d'en-tête et `docs/` : français. Un
commentaire explique _pourquoi_, pas _quoi_ — de préférence l'incident ou la contrainte qui
a dicté le choix. Le piège est dans les libellés de test, qui ressemblent à des phrases :
voir [docs/conventions.md](docs/conventions.md#écriture).

Composants standalone, signaux (`signal`, `computed`, `input()`) — la primitive à choisir
selon ce qu'on écrit est dans [docs/angular.md](docs/angular.md). Les modales Ionic
reçoivent leurs entrées via `componentProps: { x: () => valeur }`.

La logique métier va dans `domain/`, en fonctions pures testées ; les composants
orchestrent. Un effet ne sert qu'à _dériver_ : hydrater un formulaire depuis une entrée
se fait une fois, dans `ngOnInit`.

## Tests

Ils sont la **spécification exécutable** de ce dépôt : ils disent ce qui est attendu,
empêchent un retour en arrière, et font qu'un échec nomme la règle enfreinte. **Lire les
specs avant l'implémentation** est le chemin le plus court vers le contrat d'une fonction
— et le seul qui ne mente pas.

D'où la façon de les écrire : nommer la règle et non la mécanique, un invariant par test,
commenter l'attendu quand il surprend, couvrir les bords qui définissent le contrat
(absent, vide, inconnu, plus récent que ce build). Un test qui recopie l'implémentation
n'apprend rien et fige le bug avec.

Un test de régression **s'éprouve sur le code cassé** : retirer la correction, vérifier
qu'il tombe, et pour la bonne raison.

**Une simulation qui ment est pire que pas de simulation.** Un double ne rend que ce que
le vrai rendrait, formes et erreurs comprises : copié de son code, ou mesuré. Côté bot,
les règles du faux gateway en sont l'application : `nest-trading-bot/CLAUDE.md`,
« Simuler sans mentir ».

**Le domaine d'abord, les services ensuite** — non par ordre d'importance, mais parce
qu'une décision difficile à tester est une décision au mauvais endroit : la sortir en
fonction pure. Les services restent la dette de couverture actuelle
(voir [docs/conventions.md](docs/conventions.md#où-porte-leffort)).

`src/app/shared/testing/ionic-stubs.ts` fournit les doubles Ionic, branchés par un alias
`resolve` dans `vitest.config.ts` (pas un `vi.mock`). Un symbole Ionic manquant dans un
spec s'ajoute à ce fichier.

## Vérifier dans le navigateur

Les URL des services sont **configurées dans l'app** et stockées sous `app_hl_config`.
Tant que cette clé est absente, `ConfigService` s'amorce sur
`environment.defaultConfig` — en développement, la configuration de l'utilisateur :

| Réglage                    | Valeur                        |
| -------------------------- | ----------------------------- |
| User Service URL           | `http://localhost:3010`       |
| Bot Service URL            | `http://localhost:3001`       |
| Hyperliquid Gateway URL    | `http://localhost:3005`       |
| Hyperliquid Public API URL | `https://api.hyperliquid.xyz` |

Un navigateur piloté n'a donc rien à semer : le formulaire d'URL Configuration arrive
déjà rempli, il suffit de le valider. Le build de production, lui, remplace ce défaut par
des champs vides (`environment.prod.ts`) — un paquet distribué ne pointe jamais vers une
machine de développement.

Une navigation directe vers une URL `/secure/...` renvoie à l'écran de connexion : le
garde s'exécute avant la restauration de session. Passer par l'interface.
