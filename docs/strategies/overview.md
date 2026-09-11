# Strategies

## Purpose

Construire une stratégie de trading à partir d'indicateurs et de conditions, la conserver,
la regarder se comporter sur un chart, puis la confier au bot — le tout sans écrire de
code ni de JSON.

Pour la forme des données, voir [rule-model.md](rule-model.md). Pour le rendu sur le
chart, voir [../watchlist/chart-overlays.md](../watchlist/chart-overlays.md).

---

# Le parcours

```
Strategies (bibliothèque)          Watchlist                    Bot Strategies
        │                              │                              │
   créer / éditer                 attacher à un chart          attacher à une paire
        │                              │                              │
   StrategyBuilderModal          StrategyPickerModal          TradingPairModal
        │                              │                              │
        └── bibliothèque locale ───────┴──────────────────────────────┘
                   │                                                  │
          POST /exchanges/strategies/validate            PATCH /auth/strategy
                   │                                                  │
              POST /analysis (backtest, tracé)              le bot exécute
```

Une même stratégie sert donc trois usages, et c'est voulu : ce qui est backtesté sur un
chart est **littéralement** ce que le bot exécutera.

---

# Les pièces

## `StrategyDocument` (`models/strategy-document.model.ts`)

Une stratégie telle que la bibliothèque la conserve : `id`, `name`, `rules`, horodatages,
et `schemaVersion`.

`rules` est **exactement** le type partagé, sans conversion. Les deux adaptateurs
n'emballent que :

- `toAnalysisRequest(document)` — pour un backtest, l'`id` du document servant d'id de
  série de signaux ;
- `toExchangeStrategy(document)` — pour la validation serveur **et** pour l'écriture d'une
  paire du bot. Un seul adaptateur pour les deux, afin que ce qui est validé soit
  littéralement ce qui sera exécuté.

`schemaVersion` sert aussi de marqueur de provenance : une valeur supérieure à
`STRATEGY_DOCUMENT_SCHEMA_VERSION` signale un document écrit par un build plus récent,
donc susceptible de contenir des nœuds que celui-ci ne sait pas interpréter.

## `ADVANCED_RULES_SHORTNAME`

`'advanced-rules'` n'est pas une étiquette décorative : le bot **aiguille dessus**
(`pair.strategy?.shortname` dans `HlTradingEngineService`), et c'est la seule valeur pour
laquelle il exécute réellement `StrategyRules`. Toute autre valeur ferait ignorer l'arbre
en silence — d'où une constante unique, partagée par la validation et par l'écriture d'une
paire.

## `StrategyLibraryService`

La bibliothèque locale : `Preferences` (web : `localStorage`), clé `strategy_library`,
**partitionnée par adresse de wallet**. Changer de wallet change de bibliothèque.

`create`, `save` (upsert), `rename`, `duplicate`, `remove`, `load`, `getById`, et
`importMissing` — ce dernier n'ajoute que les `id` absents, pour qu'une reprise de données
relancée ne remplace pas ce que l'utilisateur a édité entre-temps
(`migrateLegacyWatchlistStrategies`).

`save` ne refuse jamais un brouillon : seule la mise en service exige une validation.

## `StrategyBuilderStore`

Fourni **par la modale** (`providers`), pas en racine : chaque ouverture repart d'un
brouillon propre, et l'arbre récursif y accède par injection plutôt que par une chaîne
d'`input`/`output`.

Il porte le nom, l'arbre, l'historique d'annulation, les `editedPaths` (voir la partition
des anomalies dans [rule-model.md](rule-model.md#anomalies--deux-axes-de-dérive-pas-un-seul))
et `focusedPath` — la navigation dans l'arbre est un état de vue, mais la loger ici évite
une chaîne d'événements à travers un composant récursif.

Deux verdicts distincts, à ne pas confondre :

- `canSave` — le nom est renseigné. C'est tout ce qu'exige un brouillon.
- `canAttach` — aucune anomalie bloquante **et** au moins un côté à évaluer. Le verdict
  serveur reste requis par-dessus.

## Composants

| Composant                       | Rôle                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `StrategyBuilderModalComponent` | nom + branches ; enregistre puis demande le verdict du bot                |
| `RuleTreeComponent`             | l'arbre, récursif                                                         |
| `RuleNodeEditorModalComponent`  | un nœud                                                                   |
| `OperandEditorModalComponent`   | un opérande — **récursif par la pile de modales**                         |
| `StrategyPickerModalComponent`  | choisir dans la bibliothèque (multi pour un chart, simple pour une paire) |

L'éditeur d'opérande ouvre la même modale un cran plus bas pour chaque sous-opérande, et
chaque niveau renvoie sa valeur au précédent à la fermeture. Aucun état partagé n'est
nécessaire — contrairement à l'arbre de règles, **un opérande est une valeur, pas un
document en cours d'édition**.

---

# Validation : deux étages

La validation locale est instantanée et sert à guider la saisie. Elle **ne fait pas
autorité** : elle s'appuie sur la copie compilée des catalogues, potentiellement en retard
sur celle que le bot exécute.

`POST /exchanges/strategies/validate` fait autorité. Il répond `200` même pour une
stratégie invalide : le rapport d'anomalies _est_ la réponse attendue, pas une erreur HTTP.

L'ordre du builder est délibéré : **l'enregistrement ne dépend jamais de la validation**
(un brouillon incomplet reste sauvegardable), mais un désaccord du serveur garde la modale
ouverte pour que le rapport soit lu plutôt qu'emporté par la fermeture. Interroger le
serveur sur une stratégie que la validation locale sait déjà incomplète n'apprendrait
rien : il répéterait les mêmes anomalies de structure.

Bot injoignable : on avertit et on laisse passer. La stratégie est locale de toute façon,
et bloquer la configuration parce que le service tousse coûterait plus que de laisser le
bot re-valider à l'exécution. La modale des paires suit le même précédent.

---

# Attacher à une paire du bot

Le catalogue déclare, pour la stratégie choisie, des paramètres `rule-builder` dont les
`id` désignent les branches (`ruleBranchesOf`). C'est ce qui décide de l'affichage de la
section « rules » dans `TradingPairModalComponent` — pas un test sur le `shortname`.

Contrat des types partagés, appliqué à la lettre : un paramètre `rule-builder` alimente
`IExchangeStrategy.rules`, un paramètre `number` / `boolean` / `select` alimente
`settings`.

**La paire conserve un instantané, pas une référence.** `IExchangeStrategy` ne porte pas
d'`id` : une paire ne peut pas se souvenir du document dont elle est issue, et c'est la
bonne sémantique — éditer une stratégie de la bibliothèque ne doit pas changer en silence
ce qu'un bot exécute déjà.

Ce qui est enregistré sur le compte est du métier : `name`, `shortname`, `description`,
`rules`, `settings`. Jamais `StrategyMeta.parameters`, qui décrit un formulaire et y
faisait vieillir une copie du catalogue. `latent` et `protective` appartiennent à la paire
et sont reconduits — sans quoi changer de stratégie effacerait les TP/SL réglés ailleurs.

En édition, la paire enregistrée est **re-appariée au catalogue par `shortname`**
(`resolveEditedStrategy`) : le schéma du formulaire vient toujours de `/exchanges/meta`,
les valeurs viennent de la paire.

---

# Limites connues

**La bibliothèque ne survit pas au changement d'appareil.** Elle est locale et partitionnée
par wallet. Une paire du bot en garde un instantané, donc le bot continue de tourner — mais
les stratégies elles-mêmes sont perdues. C'est le trou fonctionnel restant ; le combler
passerait par le service utilisateur.

**Des paires héritées n'ont pas de `shortname`.** Le bot ne peut alors pas les exécuter
(il aiguille dessus), et le formulaire laisse le sélecteur vide, forçant un nouveau choix
avant d'enregistrer. Correct, mais silencieux : un message explicite vaudrait mieux.
