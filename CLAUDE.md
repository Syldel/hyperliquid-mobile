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

| Fichier                                                              | Contenu                                             |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| [docs/ecosystem.md](docs/ecosystem.md)                               | les dépôts, qui possède quoi, la règle du catalogue |
| [docs/strategies/overview.md](docs/strategies/overview.md)           | le rule-builder de bout en bout                     |
| [docs/strategies/rule-model.md](docs/strategies/rule-model.md)       | l'arbre de règles, les chemins, les anomalies       |
| [docs/watchlist/chart-overlays.md](docs/watchlist/chart-overlays.md) | les couches du chart et les règles de pane          |
| [docs/conventions.md](docs/conventions.md)                           | exigence, usages, tests, pièges d'outillage         |
| [docs/roadmap.md](docs/roadmap.md)                                   | ce qui est remis à plus tard, et pourquoi           |

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

Les commentaires sont **en français**, les identifiants en anglais, les messages de
commit en anglais. Un commentaire explique _pourquoi_, pas _quoi_ — de préférence
l'incident ou la contrainte qui a dicté le choix.

Composants standalone, `ChangeDetectionStrategy.OnPush`, signaux (`signal`, `computed`,
`input()`). Les modales Ionic reçoivent leurs entrées via
`componentProps: { x: () => valeur }`.

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
