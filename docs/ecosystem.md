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

C'est **le seul service authentifié** : l'intercepteur y joint le JWT du wallet courant.
Une paire du bot n'existe que parce qu'elle a été écrite là.

## [nest-hyperliquid-gateway](https://github.com/Syldel/nest-hyperliquid-gateway)

Le gateway Hyperliquid interne, pour ce qui engage un compte (statut d'ordre, actions
signées). À distinguer de l'API publique Hyperliquid (`https://api.hyperliquid.xyz/info`),
interrogée directement pour les bougies, les marchés et l'information de marché.

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

Aucune URL de service n'est en dur dans le code. Les quatre (`botServiceUrl`,
`userServiceUrl`, `hyperliquidGatewayUrl`, `hyperliquidPublicUrl`) sont saisies dans
l'écran de configuration et stockées sous `app_hl_config`. Un environnement de
développement n'est donc pas décrit par un fichier du dépôt : il faut regarder ce que
l'appareil a enregistré.

## La configuration de développement de l'utilisateur

Celle sur laquelle ce projet est développé au quotidien, et celle à semer dans un
navigateur piloté pour vérifier quoi que ce soit :

| Réglage                    | Valeur                        |
| -------------------------- | ----------------------------- |
| User Service URL           | `http://localhost:3010`       |
| Bot Service URL            | `http://localhost:3001`       |
| Hyperliquid Gateway URL    | `http://localhost:3005`       |
| Hyperliquid Public API URL | `https://api.hyperliquid.xyz` |

```js
localStorage.setItem(
  'CapacitorStorage.app_hl_config',
  JSON.stringify({
    userServiceUrl: 'http://localhost:3010',
    botServiceUrl: 'http://localhost:3001',
    hyperliquidGatewayUrl: 'http://localhost:3005',
    hyperliquidPublicUrl: 'https://api.hyperliquid.xyz',
  }),
);
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
