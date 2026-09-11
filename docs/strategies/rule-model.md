# Rule Model

## Purpose

Une stratégie « advanced-rules » est un **arbre de conditions**, pas un jeu de réglages.
Le type est défini dans `trading-shared-types` et n'est jamais converti en route : le même
objet est édité ici, validé par le bot, backtesté par `POST /analysis` et exécuté en
production. Les adaptateurs de `models/strategy-document.model.ts` emballent, ils ne
transforment pas.

Ce document décrit la forme de cet arbre et les outils qui l'accompagnent dans
`features/secure/strategies/domain/`. Pour le parcours utilisateur, voir
[overview.md](overview.md).

---

# Quatre branches indépendantes

```
rules
├── long
│   ├── entry   (obligatoire dès que `long` existe)
│   └── exit    (optionnelle)
└── short
    ├── entry   (obligatoire dès que `short` existe)
    └── exit    (optionnelle)
```

Chaque branche est un `LogicalGroup` autonome. **Rien n'oblige à définir les deux côtés** :
une stratégie purement longue ne porte pas de `short`, et c'est un cas normal, pas un
brouillon. C'est une source de confusion récurrente à la lecture d'un chart — sélectionner
une stratégie ne signifie pas qu'un comportement short a été défini.

`SideRules` impose `entry` : ouvrir `exit` en premier crée donc les deux d'un coup, avec
une `entry` vide. Cette entrée vide est structurellement valide ; seule la validation la
signale. `pruneEmptyRuleBranches` nettoie à l'enregistrement, mais conserve une `entry`
vide si `exit` a du contenu — sans quoi la branche voulue disparaîtrait avec elle.

Les identifiants de branche (`long.entry`, `short.exit`) ne sont pas inventés ici : ce
sont les `id` des paramètres `rule-builder` que le catalogue déclare pour la stratégie
(`ruleBranchesOf`). `DEFAULT_STRATEGY_BRANCHES` n'est qu'un défaut pour la bibliothèque
locale ; l'éditeur reçoit les branches en entrée, ce qui lui permet d'afficher celles
qu'une stratégie particulière expose.

---

# Nœuds et opérandes

Deux unions fermées, toutes deux dans le paquet partagé.

**`RuleNode`** — ce qu'une branche évalue :

| Type         | Porte                                   |
| ------------ | --------------------------------------- |
| `logical`    | `operator` (AND/OR) + `conditions[]`    |
| `comparison` | `left`, `operator`, `right`             |
| `cross`      | `left`, `direction`, `right`            |
| `trend`      | `target`, `direction`, `period`, `mode` |
| `not`        | `condition`                             |
| `constant`   | `value`                                 |

**`Operand`** — ce qu'une condition compare :

| Type        | Porte                                          | Composé |
| ----------- | ---------------------------------------------- | ------- |
| `price`     | `field`, `offset?`                             | non     |
| `number`    | `value`                                        | non     |
| `indicator` | `name`, ses paramètres, `subField?`, `offset?` | non     |
| `arith`     | `operator`, `left`, `right`                    | oui     |
| `transform` | `kind`, `period?`, `source`, `offset?`         | oui     |
| `fn`        | `kind`, `args[]`                               | oui     |

Les trois types composés contiennent d'autres opérandes, sans limite de forme mais avec
une limite de profondeur : la validation partagée rejette au-delà de 6
(`*_TOO_DEEP`). L'éditeur cesse de les proposer à partir de **5**
(`MAX_OPERAND_NESTING`), pour ne pas laisser construire ce que le serveur refusera. C'est
un garde-fou d'ergonomie, pas de sûreté — la validation reste seule juge, et un type
inconnu de ce build n'est jamais filtré au hasard.

Les paramètres d'un indicateur sont **écrits explicitement** dans l'opérande, même laissés
à leur valeur par défaut. Une stratégie doit continuer à calculer la même chose si les
défauts du bot changent.

`offset` ne change pas la série calculée, seulement la position lue dedans. C'est pourquoi
il est exclu des clés (`buildOperandKey`, `expressionId`) et retiré avant de tracer une
expression.

---

# Adressage par chemin

`rules.long.entry.conditions[0].left`

Exactement la forme produite par `collectStrategyRulesIssues` côté partagé. Le vocabulaire
est unique et délibéré : une anomalie de validation et une opération d'édition désignent le
même sous-arbre avec la même chaîne, sans traduction. C'est ce qui rend possible le blocage
adressé par chemin décrit plus bas.

`strategy-path.util.ts` fournit `parseStrategyPath`, `formatStrategyPath`, `childPath`,
`parentPath` et `isPathInside`. Aucune de ces fonctions ne lève : ces chemins viennent
d'une réponse serveur ou d'un document stocké, donc de données non typées — un chemin
illisible s'ignore, il ne fait pas tomber l'éditeur.

`isPathInside` compare **segment par segment**, jamais par préfixe de chaîne :
`rules.long.entry` n'est pas un ancêtre de `rules.long.entryX`.

⚠️ Les chemins renvoyés par `POST /exchanges/strategies/validate` sont préfixés
`strategy.rules…` là où les chemins locaux disent `rules…`. Aujourd'hui on n'affiche que
le message, donc l'écart ne se voit pas ; il faudra retirer le préfixe le jour où on
voudra surligner le nœud fautif dans l'arbre.

---

# Opérations immuables

`strategy-tree.ops.ts` — `getAtPath`, `replaceAtPath`, `removeAtPath`, `appendCondition`,
`pruneEmptyRuleBranches`.

Toutes rendent un nouvel arbre et **garantissent le verbatim** : ce qui n'est pas touché
est conservé à l'identique, y compris les clés que ce build ne connaît pas. Un document
écrit par une version plus récente traverse donc l'éditeur sans perdre ce qu'il porte.

Corollaire respecté partout : une écriture sans effet renvoie la **même référence**, de
haut en bas. Sans cette propagation, une opération neutre créerait un nouvel objet, ferait
croire à un changement, et pousserait une entrée inutile dans l'historique d'annulation.

---

# Anomalies : deux axes de dérive, pas un seul

`strategy-issues.util.ts` est le fichier à lire avant de toucher à la validation.

**Axe client ↔ serveur** — traité par le paquet partagé. Un nom d'indicateur ou un `kind`
de transformation inconnu localement peut simplement être plus récent côté bot.
`CATALOG_DEPENDENT_ISSUE_CODES` / `isCatalogDependentIssue` marquent ces anomalies : le
client ne tranche pas, il laisse le verdict au serveur.

**Axe document ↔ client** — propre au mobile, parce que le mobile est le seul à _ouvrir_
des documents. Une stratégie écrite par un build plus récent peut contenir un type de nœud
ou une valeur d'énumération absente des unions compilées ici. La justification donnée aux
codes de structure (« les unions ne peuvent pas diverger sans rebuild des deux côtés ») est
exacte sur le premier axe et ne s'applique pas au second.

Appliquée à la lettre, la règle « tout code de structure bloque » rendrait toute stratégie
issue d'un build plus récent définitivement inéditable — pas même renommable. D'où la
distinction, sur les seuls codes de structure :

- **valeur non reconnue** (`UNKNOWN_NODE_TYPE`, `UNKNOWN_*_OPERATOR`…) : verdict laissé au
  serveur **si** l'anomalie tombe hors de ce que ce build vient d'éditer ;
- **valeur malformée** (`INVALID_TREND_PERIOD`, `EMPTY_LOGICAL_CONDITIONS`, `*_TOO_DEEP`,
  `MISSING_*`…) : toujours bloquant, aucune version future ne rendra un offset négatif
  valide.

Une anomalie « valeur non reconnue » **dans** un sous-arbre que l'utilisateur vient de
toucher bloque, elle : ce n'est plus un héritage, c'est un bug d'ici. D'où le suivi des
`editedPaths` dans le store, et `partitionStrategyIssues(issues, editedPaths)`.

`isLocallyExecutable(rules)` résume le tout pour les appelants qui veulent juste savoir
s'ils peuvent envoyer la stratégie au bot.

---

# Affichage d'un arbre

`strategy-format.util.ts` rend un nœud ou un opérande en une ligne :
`zscore(EMA(9), 200) > 2`, `close < max(EMA(9), SMA(20))`.

Les symboles compacts (`≥`, `×`, `↗`) sont des `Record` exhaustifs : ajouter une valeur à
une énumération partagée casse la compilation ici plutôt que d'afficher un trou. Pour les
libellés en revanche, le rendu préfère **la grammaire servie par le serveur**, et ne
retombe sur un mot local que si elle manque.

Un nœud que ce build ne sait pas interpréter s'affiche `Unsupported` et passe en lecture
seule — jamais bloquant, jamais effacé.
