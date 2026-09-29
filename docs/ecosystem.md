# Project Ecosystem

## Purpose

Ce projet (`hyperliquid-mobile`) ne fonctionne pas seul. Il est le frontend d'un ensemble
de services maison, développés et maintenus par la même personne, chacun avec une
responsabilité isolée.

Cette carte sert à éviter deux erreurs fréquentes pour un agent IA :

- supposer qu'une fonctionnalité doit être développée ici alors qu'elle appartient à un
  autre dépôt ;
- supposer qu'un dépôt tiers (dépendance npm classique, package public) est la source de
  vérité alors que c'est un projet maison sur lequel on a la main.

Une troisième, propre au frontend, est traitée plus bas :
[le catalogue vient du serveur](#le-catalogue-vient-du-serveur), jamais du paquet compilé.

---

# Ce que fait cette application

Elle **affiche et configure**. Elle ne calcule ni indicateur, ni signal, ni backtest :
tout cela est demandé au bot et rendu tel quel. Quand un écran a besoin d'une valeur
dérivée, le réflexe est de vérifier si une route existe avant d'écrire le calcul ici.

Ce qui lui appartient en propre :

- la construction d'une stratégie (rule-builder) et sa **bibliothèque locale** ;
- l'attachement de stratégies et d'indicateurs à un chart, et leur rendu ;
- la configuration des paires du bot, envoyée au service utilisateur ;
- la session, le stockage local, la configuration des URL de services.

---

# Backend services

## [nest-trading-bot](https://github.com/Syldel/nest-trading-bot)

Le moteur de stratégies. Sert le catalogue (`GET /exchanges/meta`), l'analyse et le
backtest (`POST /analysis`), et la validation d'une stratégie
(`POST /exchanges/strategies/validate`). Il exécute les paires configurées ici.

Ses `docs/` font autorité sur les contrats. En particulier
[`docs/trading/mobile-app-integration.md`](https://github.com/Syldel/nest-trading-bot/blob/main/docs/trading/mobile-app-integration.md)
décrit ce que le mobile a le droit de supposer — le lire avant de toucher à un contrat
d'API plutôt que de déduire la règle depuis le code d'ici.

Les routes consommées ici ne sont pas protégées : en développement, il suffit que le bot
tourne et que l'origine de l'app figure dans son `ALLOWED_ORIGINS`.

## [nest-mongo-user](https://github.com/Syldel/nest-mongo-user)

Utilisateurs, clés privées, et la configuration de trading de chaque compte. Deux routes
seulement sont consommées ici : `GET /auth/me` et `PATCH /auth/strategy`.

C'est **le seul service qui exige une authentification**. Une paire du bot n'existe que
parce qu'elle a été écrite là.

⚠️ « Le seul service qui exige une authentification » ne veut pas dire « le seul qui reçoit
le jeton » : le gateway le vérifie aussi. Qui le reçoit, et pourquoi : voir plus bas.

## [nest-hyperliquid-gateway](https://github.com/Syldel/nest-hyperliquid-gateway)

Le gateway Hyperliquid interne, pour ce qui engage un compte (statut d'ordre, actions
signées). À distinguer de l'API publique Hyperliquid (`https://api.hyperliquid.xyz/info`),
interrogée directement pour les bougies, les marchés et l'information de marché.

Il **vérifie le JWT du wallet** : `UserAuthGuard` porte sur ses contrôleurs d'ordres, de
trade, d'info et de fills, et valide la signature avec le même `JWT_USER_SECRET` que
`nest-mongo-user`. C'est donc, avec ce dernier, l'un des deux seuls destinataires légitimes
du jeton.

---

# Le modèle de session : une adresse mémorisée, un jeton optionnel

C'est un choix d'architecture, pas un état de fait provisoire, et il explique plusieurs
choses qui surprennent à la lecture du code.

**On se connecte une fois**, pour créer l'entrée et mémoriser l'adresse du wallet.
Ensuite, l'essentiel de ce que l'app donne à voir — l'évolution d'une position, les
bougies, les marchés — passe par l'**API publique Hyperliquid**, qui ne demande rien. Le
login ne revient donc que devant une route qui exige vraiment une authentification.

Le code dit exactement cela :

|                         |                                                                            |
| ----------------------- | -------------------------------------------------------------------------- |
| `/secure` est gardé par | **`WalletGuard`** — il exige `currentAddress()`, une adresse **mémorisée** |
| `AuthGuard` exige       | `isLoggedIn()`, donc un jeton valide…                                      |
| …et garde               | **rien**. Il n'est importé par aucun fichier (vérifié le 2026-09-29)       |

**Conséquence, et elle est délibérée : un 401 ne déconnecte pas.** L'intercepteur le
journalise et le relaie à l'appelant, sans toucher à la session. Déconnecter éjecterait
l'utilisateur d'écrans qui n'avaient pas besoin de lui. Les lignes commentées dans
`auth.interceptor.ts` sont ce choix, pas un chantier inachevé — et
`auth.interceptor.spec.ts` le **fige** : réactiver la déconnexion fait rougir la suite.

⚠️ Ne pas câbler `AuthGuard` sur `/secure` en croyant réparer un oubli. Ce serait
remplacer cette architecture par une autre.

## À qui le jeton a le droit d'être montré

**Deux services le valident, et l'intercepteur ne le joint qu'à eux :**

| Service                    | Reçoit le jeton | Pourquoi                                                                                           |
| -------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `nest-mongo-user`          | **oui**         | il l'émet, et il le vérifie sur `/auth/me` et `/auth/strategy`                                     |
| `nest-hyperliquid-gateway` | **oui**         | `UserAuthGuard` sur ses contrôleurs d'ordres, de trade, d'info et de fills, même `JWT_USER_SECRET` |
| `nest-trading-bot`         | non             | aucun garde sur les routes consommées ici                                                          |
| `api.hyperliquid.xyz`      | **non**         | un tiers                                                                                           |

Jusqu'au 2026-09-29, il partait vers **les quatre** : le seul filtre était « l'URL ne finit
pas par `/login` », sans aucune notion de destinataire. Le JWT du wallet était donc transmis
à `api.hyperliquid.xyz` à chaque bougie et chaque appel de marché — un jeton remis à un
tiers est un jeton qu'on ne contrôle plus, il vit désormais dans ses journaux.

⚠️ Le réflexe naïf — « restreindre au service utilisateur » — **aurait cassé le trading**,
le gateway validant le même jeton. C'est la lecture de `user-auth.guard.ts` dans son dépôt
qui l'a évité, pas le raisonnement.

Vérifié à l'exécution le 2026-09-29, en observant les en-têtes réellement émis :
`localhost:3010` les reçoit, `localhost:3001` et `api.hyperliquid.xyz` ne les reçoivent
plus. Le gateway n'a pas été sollicité — ses seuls appelants sont le formulaire d'ordre et
le détail d'un ordre — et reste couvert par `auth.interceptor.spec.ts`, dont une mutation
retirant le gateway de la liste fait rougir la suite.

### Comment le destinataire est reconnu

Pas « l'une des deux bases de confiance préfixe l'URL » : **celui des quatre services dont
la base correspond le plus longuement**, puis on regarde s'il valide le jeton.

La nuance ne se voit pas en développement, où chaque service a son port. Elle décide en
production, où les topologies sont variées — et neuf d'entre elles ont été confrontées à
l'implémentation avant d'être figées en tests :

| Topologie                                                                   | Ce qu'elle change                                                                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| sous-domaines distincts (`user.`, `gateway.`, `bot.`)                       | rien, le cas facile                                                                                               |
| un seul hôte, préfixes de chemin (`/user`, `/gateway`, `/bot`)              | rien                                                                                                              |
| **un service à la racine d'un hôte, un autre sous un chemin du même hôte**  | ⚠️ la comparaison naïve donnait le jeton au bot, dont l'URL commence bel et bien par celle du service utilisateur |
| **l'API publique relayée sous un chemin de confiance** (contournement CORS) | ⚠️ sans elle dans l'arbitrage, le proxy héritait de la confiance de son hôte                                      |
| barres finales dans la configuration, port explicite                        | rien, normalisés                                                                                                  |
| **deux services sur exactement la même base**                               | à égalité on ne devine pas : le jeton ne part pas                                                                 |
| domaine sosie (`user.mondomaine.fr.attaquant.net`)                          | rejeté par la frontière sur le `/`                                                                                |
| **rien de configuré**, URL relative                                         | une base vide est refusée, sans quoi `startsWith('/')` livrerait tout `/assets/…`                                 |

---

# Shared type libraries

## [trading-shared-types](https://github.com/Syldel/trading-shared-types)

Modèles génériques du bot : l'AST des stratégies (`RuleNode`, `Operand`), les contrats
d'API (`AnalysisRequest`, `ExchangesMetaResponse`), la validation partagée
(`collectStrategyRulesIssues`), les registres d'indicateurs et de transformations.

Épinglé par **tag git** dans `package.json`
(`github:Syldel/trading-shared-types#vX.Y.Z`). Faire évoluer ce tag est une décision de
l'utilisateur : il lance `npm version` dans l'autre dépôt lui-même, et on ne touche
jamais à `package.json("version")` à la main.

## [hl-shared-types](https://github.com/Syldel/hl-shared-types)

Modèles spécifiques à Hyperliquid et au gateway interne.

---

# Le catalogue vient du serveur

C'est la règle structurante de ce dépôt, et la source de l'incident qui l'a motivée.

`trading-shared-types` contient à la fois des **types** (sans risque) et des
**catalogues** : la liste des indicateurs, leurs paramètres et leurs valeurs par défaut,
les transformations, les fonctions, la grammaire du rule-builder. Ces catalogues sont
compilés dans le build mobile au moment où la dépendance est installée.

Le bot, lui, exécute la version qu'il a installée de son côté. Rien ne garantit que ce
soient les mêmes. Un build mobile qui dérive sa propre liste, son propre ordre ou ses
propres valeurs par défaut depuis le paquet compilé diverge alors **en silence** : un
`ema` sans période explicite se lit `ema_9` d'un côté et `ema_12` de l'autre, et la série
demandée devient introuvable dans la réponse.

D'où la règle : **tout ce qui est catalogue se lit depuis `GET /exchanges/meta`**, via
`BotService`. Sont interdits comme imports de valeur `INDICATOR_REGISTRY`,
`INDICATOR_DEFAULTS`, `INDICATOR_SUBFIELDS`, `AVAILABLE_*_METADATA`,
`RULE_BUILDER_GRAMMAR`, ainsi que les helpers qui complètent des paramètres manquants
depuis ces registres (`buildIndicatorKey`, `buildIndicatorKeyFromOperand`,
`resolveIndicatorParams`, `computeStrategyRulesLookback`…).

`src/app/shared/testing/no-catalog-imports.spec.ts` porte la liste exacte et la vérifie
sur tout `src/app`. Un `import type` reste libre : il est effacé à la compilation, donc
structurellement incapable de diverger. Les exceptions sont nominatives et documentées à
leur point d'usage.

Ce qui _n'est pas_ un catalogue reste libre d'usage : les types, et les fonctions pures
sur l'AST (`walkRuleTree`, `collectStrategyRulesIssues`, `pruneEmptyRuleBranches`…).
Attention toutefois aux fonctions qui **appellent** un helper de catalogue :
`buildOperandKey` en fait partie, ce qui explique qu'une expression envoyée à
`POST /analysis` porte toujours un `id` calculé localement plutôt que de laisser le
serveur dériver la clé.

## Handshake de version

`ExchangesMetaResponse.packageVersion` annonce la version que le bot exécute.
`BotService.hasPackageVersionMismatch` la compare à celle compilée ici, et
`VersionMismatchBannerComponent` l'affiche. La bannière couvre la dérive de _version_ ;
elle ne couvre pas la dérive décrite ci-dessus, qui existe même à versions égales dès
qu'on lit le paquet au lieu de la réponse.

## Validation : deux étages, pas un seul

La validation locale (`collectStrategyRulesIssues`) est instantanée et sert à guider la
saisie. Elle ne fait **pas** autorité : elle s'appuie sur la copie compilée des
catalogues. Le verdict qui compte est `POST /exchanges/strategies/validate`, demandé
avant d'attacher une stratégie ou de l'écrire sur un compte. `CATALOG_DEPENDENT_ISSUE_CODES`
et `isCatalogDependentIssue` marquent les anomalies dont le client n'a pas le droit de
trancher.

---

# Configuration à l'exécution

Aucune URL de service n'est en dur dans le code qui l'utilise. Les quatre
(`botServiceUrl`, `userServiceUrl`, `hyperliquidGatewayUrl`, `hyperliquidPublicUrl`) sont
saisies dans l'écran de configuration et stockées sous `app_hl_config` ; c'est cette clé
qui fait foi, et elle seule. Ce qu'un appareil a enregistré reste donc la source à
regarder en cas de doute.

Ce qui vient du dépôt, c'est uniquement l'**amorçage** utilisé tant que `app_hl_config`
est absente : `environment.defaultConfig`, lu une fois par `ConfigService`. En
développement il porte les valeurs ci-dessous ; en production (`environment.prod.ts`,
substitué par `fileReplacements`) il ne porte que l'API publique Hyperliquid, les trois
autres champs restant vides — et donc invalides pour le formulaire, qui force la saisie
plutôt que de laisser un paquet distribué interroger silencieusement un `localhost`
inexistant.

## La configuration de développement de l'utilisateur

Celle sur laquelle ce projet est développé au quotidien, et celle que `ng serve`
pré-remplit désormais tout seul :

| Réglage                    | Valeur                        |
| -------------------------- | ----------------------------- |
| User Service URL           | `http://localhost:3010`       |
| Bot Service URL            | `http://localhost:3001`       |
| Hyperliquid Gateway URL    | `http://localhost:3005`       |
| Hyperliquid Public API URL | `https://api.hyperliquid.xyz` |

Dans un navigateur piloté, il n'y a donc plus rien à semer : ouvrir _URL Configuration_
depuis l'écran de connexion et valider suffit. Pour retrouver ce cas de départ après
coup, vider la clé enregistrée :

```js
localStorage.removeItem('CapacitorStorage.app_hl_config');
```

Le bot doit par ailleurs accepter l'origine de l'app dans son `ALLOWED_ORIGINS`.

---

# Rule for AI assistants

Avant de développer une fonctionnalité qui semble toucher au calcul d'un indicateur, à
l'exécution d'une stratégie, aux utilisateurs ou aux clés, vérifier si elle appartient en
réalité à l'un des dépôts ci-dessus plutôt qu'à `hyperliquid-mobile`.

Ne pas modifier le code de ces dépôts depuis ce projet : ce sont des dépendances externes
avec leur propre cycle de vie. Les `docs/` de `nest-trading-bot` font autorité sur les
contrats d'API ; en cas de désaccord entre ce qu'ils décrivent et ce que fait le code
d'ici, c'est le code d'ici qui est suspect.
