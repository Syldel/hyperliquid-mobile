# Conventions

## Purpose

Les usages de ce dépôt qui ne se devinent pas, et les pièges d'outillage qui coûtent une
demi-heure quand on ne les connaît pas. Les règles impératives tiennent dans
[../CLAUDE.md](../CLAUDE.md) ; ce document explique le pourquoi.

---

# Exigence de robustesse

Cette application servira d'**outil de trading, avec de l'argent réel**. C'est la
contrainte qui arbitre tous les choix de ce dépôt, et elle mérite d'être dite avant les
conventions d'écriture : un bug silencieux n'y coûte pas un affichage de travers, il coûte
une position prise sur une donnée fausse — ou pas prise du tout, sans que rien ne le
signale.

La philosophie est donc **robustesse et fiabilité d'abord**, au prix assumé d'un peu de
confort : peu de place à l'approximation, aucune à l'incertitude qui dort.

## Aucune défaillance muette

Ce qui ne peut pas être fait doit se voir. Les exemples du dépôt valent mieux qu'une
règle abstraite :

- l'analyse échoue : le chart retombe sur des bougies nues **et le dit** (un toast). Avant,
  les indicateurs disparaissaient sans un mot, et une panne de service se lisait comme
  « cet indicateur ne donne rien » — le pire diagnostic possible sur un outil de trading ;
- une expression n'a pas de valeur à un instant : le trait **s'interrompt**. Filtrer le
  point relierait les deux bords par une droite qui se lirait comme une valeur ;
- une série d'indicateur ne se retrouve pas dans la réponse : elle est **abandonnée**, pas
  attribuée à l'indicateur voisin (elle l'était, par index, en silence) ;
- un nœud que ce build ne sait pas interpréter s'affiche `Unsupported` en lecture seule,
  jamais effacé ni deviné.

## Toujours pouvoir reconstituer ce qui s'est passé

Un comportement doit être explicable après coup : d'où vient cette valeur, qui en fait
autorité, quelle version a écrit ce document. D'où `schemaVersion` sur un
`StrategyDocument`, le handshake de version avec le bot, les chemins d'anomalie qui
désignent un nœud précis, et le compte de points indéterminés affiché sur une courbe.

C'est aussi la raison d'être des commentaires : ils enregistrent l'incident, pas
l'intention.

## Anticiper les divergences plutôt que les subir

Quand deux sources peuvent diverger, le code doit dire **laquelle fait autorité**. Le
catalogue vient du bot, jamais du paquet compilé
([ecosystem.md](ecosystem.md#le-catalogue-vient-du-serveur)). Le verdict de validité vient
du serveur, jamais de la validation locale. Un client ne tranche pas ce qu'il ne peut pas
savoir — et quand il diffère son jugement, il le dit au lieu de faire comme si tout allait
bien.

## Une incertitude se résout ou s'écrit

Ce qu'on n'a pas pu vérifier ne se laisse pas dormir : ça s'écrit, en toutes lettres, là
où quelqu'un le lira au bon moment. Les `⚠️` de ces docs sont exactement ça — un risque
identifié, non reproduit, avec l'endroit où chercher s'il se manifeste.

En cas de doute, préférer l'option qui échoue **bruyamment et tôt** à celle qui continue
en apparence.

---

# Écriture

**Commentaires en français, identifiants en anglais, messages de commit en anglais.**

Un commentaire explique _pourquoi_, jamais _quoi_ — de préférence l'incident ou la
contrainte qui a dicté le choix. Les commentaires de ce dépôt servent beaucoup à ça :
`ionic-stubs.ts` cite le numéro d'issue Ionic qui les rend nécessaires,
`strategy-issues.util.ts` expose le raisonnement complet avant la première ligne de code.
Un commentaire qui paraphrase le code est du bruit ; un commentaire qui dit « ceci a été
essayé autrement et voici ce qui s'est cassé » vaut une heure à quelqu'un.

Les gros modules de domaine ouvrent sur un bloc d'en-tête encadré
(`==== 🧭 STRATEGY PATH ====`). Suivre le format quand on en ajoute un.

---

# Angular

Composants **standalone**, `ChangeDetectionStrategy.OnPush`, signaux partout :
`signal`, `computed`, `input()`.

Les modales Ionic reçoivent leurs entrées via `componentProps: { x: () => valeur }`.
Ionic affecte les `componentProps` directement sur l'instance ; une fonction est donc ce
qu'un `input()` signal peut consommer de façon interchangeable.

## Un effet dérive, il n'hydrate pas

Règle apprise en cassant quelque chose. Le pré-remplissage d'un formulaire en mode édition
vivait dans un `effect` ; cet effet se ré-exécutait à chaque fermeture d'une modale ouverte
par-dessus, **remettant tout le formulaire aux valeurs enregistrées** et effaçant ce que
l'utilisateur venait de saisir. Le défaut est resté invisible des mois parce que la seule
sous-modale existante réécrivait son champ après coup.

Hydrater depuis une entrée est un geste **ponctuel** : il se fait dans `ngOnInit`. Un
`effect` ne sert qu'à maintenir une chose en cohérence avec une autre, indéfiniment.

## Où va la logique

Dans `domain/`, en fonctions pures et testées. Les composants orchestrent : ils appellent,
ils affichent, ils ne calculent pas.

Le découpage se voit dans les tests : ils portent sur du domaine, des utilitaires et des
services — jamais sur du rendu Ionic.

---

# Tests

`npx ng test --watch=false` — Vitest via `@angular/build:unit-test`.

## À quoi ils servent ici

Les tests sont la **spécification exécutable** de ce dépôt. Trois rôles, dans cet ordre
d'importance :

1. **Dire ce qui est attendu.** Un spec se lit avant l'implémentation : c'est le chemin le
   plus court vers le contrat d'une fonction, et le seul qui ne mente pas — un commentaire
   peut vieillir, un test vert ne peut pas.
2. **Empêcher un retour en arrière.** Un défaut corrigé et non verrouillé revient.
3. **Permettre de se corriger seul.** Un échec doit nommer l'invariant violé, pas
   seulement signaler que « quelque chose » ne va plus.

Pour un agent qui découvre ce code, le troisième rôle dépend entièrement du premier : un
test qui décrit une intention apprend quelque chose, un test qui recopie l'implémentation
n'apprend rien et fige le bug avec.

## Écrire un test qui apprend quelque chose

Ce qui rend un spec utile à quelqu'un — humain ou agent — qui arrive sans le contexte :

- **Nommer la règle, pas la mécanique.** `it('never reports the conditions array as the offending line')`
  est une phrase de spécification ; `it('works')` n'en est pas une. Le nom seul doit
  suffire à comprendre ce qui est promis.
- **Un invariant par test.** Un échec désigne alors exactement la règle enfreinte. Un test
  qui vérifie dix choses dit seulement qu'une des dix a lâché.
- **Commenter l'attendu quand il surprend.** Les specs d'ici rappellent l'incident —
  « `conditions` est un tableau : le retenir signalerait la liste entière ». Cette phrase
  empêche qu'on « simplifie » plus tard une assertion qui avait une raison d'être.
- **Couvrir les bords qui définissent le contrat** : absent, vide, inconnu, plus récent
  que ce build. C'est là que vit l'intention, et c'est ce qu'on ne devine pas en lisant
  l'implémentation.
- **Des fixtures réalistes.** Un `StrategyRules` vraisemblable enseigne la forme de la
  donnée en même temps qu'il teste ; un `{ a: 1 }` n'enseigne rien.
- **Exprimer l'intention, pas le moyen.** Si refactorer sans changer le comportement casse
  le test, il testait l'implémentation.

Et la règle de méthode, sur un outil qui engagera de l'argent : **un test de régression
s'éprouve sur le code cassé.** Retirer la correction, vérifier que le test tombe — et
qu'il tombe pour la bonne raison, sans emporter les autres. Un test qui passe dans les
deux cas ne protège de rien et donne une fausse assurance, ce qui est pire que pas de test
du tout.

## Où porte l'effort

**Le domaine d'abord, les services ensuite** — mais ce n'est pas un classement
d'importance, c'est une conséquence de conception.

Le domaine est fait de fonctions pures : pas de double, pas d'ordonnancement, une entrée
et une sortie. C'est là que le rapport entre ce qu'un test coûte et ce qu'il garantit est
le meilleur, et c'est là que se trouvent les règles métier qu'un agent doit comprendre —
ce qu'est une stratégie valide, où pointe une anomalie, sur quelle échelle se lit un
opérande. Un spec de domaine est une définition ; un spec de service est une mise en
situation.

D'où la règle de construction : **quand une décision est difficile à tester, c'est qu'elle
est au mauvais endroit.** La sortir en fonction pure et la tester là. C'est exactement ce
qui s'est passé pour les panneaux du chart — `position-segments`, `expression-series` et
`strategy-markers` ont été extraits des services qui les utilisaient, et ces services sont
devenus des enveloppes d'appels à lightweight-charts, que le navigateur vérifie mieux
qu'un double.

Les services ne disparaissent pas pour autant : ils parlent à l'extérieur, portent l'état,
orchestrent — et ce sont eux dont une panne muette se paie. C'est la dette actuelle. Le
domaine est très bien couvert (arbre de règles, chemins, anomalies, échelles, séries) ; la
couche service beaucoup moins.

Testés : `auth.service`, `bot.service`, `strategy-library.service`, et le
`strategy-builder.store`.

Pas encore couverts, par ordre de ce que leur défaillance coûterait :

| Service                                      | Ce qu'une panne muette y coûterait                         |
| -------------------------------------------- | ---------------------------------------------------------- |
| `user.service`                               | l'écriture de la config de trading sur le compte           |
| `chart-analysis.service`                     | l'analyse et le backtest, donc toute décision prise dessus |
| `available-capital.service`                  | le capital auquel un ratio s'applique                      |
| `storage.service` / `secure.storage.service` | la persistance sous tout le reste                          |
| `watchlist.service`, `config.service`        | les réglages et la liste suivie                            |
| `hyperliquid-*`                              | données de marché et statut d'ordre                        |

Les services de pane et d'overlay (`expressions-pane`, `strategy-positions-pane`,
`indicator-overlay`) sont le cas traité plus haut : leur logique testable est déjà sortie,
ce qui reste est de l'appel de librairie — c'est là que la vérification dans un navigateur
reste le bon outil.

## Les stubs Ionic

Importer quoi que ce soit de `@ionic/angular` charge **tout** son bundle, y compris une
ligne d'import ESM cassée sous Vitest
([ionic-framework#30982](https://github.com/ionic-team/ionic-framework/issues/30982)), au
moment même où le fichier du composant testé est chargé — avant que `TestBed` n'entre en
jeu. Ni `CUSTOM_ELEMENTS_SCHEMA` ni `TestBed.overrideComponent` ne peuvent intercepter ça
après coup.

`src/app/shared/testing/ionic-stubs.ts` fournit des remplaçants minimalistes, branchés par
un **alias `resolve`** dans `vitest.config.ts`. Un spec n'a rien à déclarer.

Deux détails qui ont coûté cher :

- **Un alias, pas un `vi.mock`.** Le `vi.mock` d'un fichier de setup passait par un
  registre propre à chaque worker Vitest, qui échouait à résoudre le chemin **au-delà de
  15 fichiers de spec en mode watch** (`Cannot read properties of undefined (reading
'trim')`), chaque fichier supplémentaire faisant tomber un spec de plus — sans rapport
  avec le contenu du spec accusé. Un alias est résolu au chargement du module.
- **Des expressions ancrées, pas des chaînes.** Vite fait de la correspondance par
  sous-chaîne : `find: '@ionic/angular'` capturerait aussi `@ionic/angular/standalone`.

Un symbole Ionic manquant dans un nouveau spec s'ajoute à `ionic-stubs.ts` — c'est la
règle que le fichier documente lui-même.

## Le garde-fou de catalogue

`src/app/shared/testing/no-catalog-imports.spec.ts` parcourt tout `src/app` et refuse
qu'un catalogue du paquet partagé soit importé comme valeur. Il porte la liste exacte des
symboles interdits et les exceptions nominatives. Le raisonnement est dans
[ecosystem.md](ecosystem.md#le-catalogue-vient-du-serveur).

---

# Formatage

`npm run format` réécrit **tout** `src/`. Sur Windows avec `core.autocrlf=true`, cela
reformate les fins de ligne de fichiers qu'on n'a pas touchés, et le diff se remplit de
bruit.

Formater **fichier par fichier** :

```bash
npx prettier --write <chemin> [<chemin>…]
```

Et vérifier avec `git diff --numstat <file>` : une sortie vide signifie « fins de ligne
seulement » — restaurer le fichier (`git checkout --`, qui ne peut rien pour un fichier
non suivi).

---

# Git

**Ne jamais committer, tagger ou pousser sans demande explicite.** Proposer un message
conventionnel et laisser l'utilisateur l'exécuter est le mode de fonctionnement établi,
dans les trois dépôts.

Les messages sont en anglais, au format conventionnel, et le corps dit **pourquoi**. Un
changement qui mêle un correctif indépendant et une fonctionnalité se découpe en deux
commits ; quand les deux touchent le même fichier, préparer l'index pour le premier et
laisser l'arbre de travail complet fonctionne bien — le commit prend ce qui est indexé,
le suivant prend le reste.

**Ne jamais éditer `package.json("version")` à la main**, ici ou dans les dépôts liés :
l'utilisateur lance `npm version` lui-même. La dépendance aux types partagés est épinglée
par tag git ; la faire évoluer est une décision.

**Vérifier l'état réel avant de ré-implémenter.** Lire le fichier et `git log` avant de
refaire une étape supposée manquante.

---

# Vérifier dans un navigateur

L'app tourne sur `http://localhost:4200`. Les URL des services sont saisies dans
l'application et stockées sous `app_hl_config` — elles ne sont pas dans le dépôt.

Deux pièges :

- une **navigation directe** vers une URL `/secure/...` renvoie à l'écran de connexion,
  le garde s'exécutant avant la restauration de session. Passer par l'interface ;
- une modale Ionic **fermée traîne un instant dans le DOM** : `querySelectorAll('ion-modal')`
  peut renvoyer celle qui vient de se fermer. Cibler par titre ou par composant.

Et un rappel de méthode : quand une capture d'écran contredit le DOM, c'est la capture
qui ment. Interroger l'état réel (`read_page`, une requête DOM, l'API du chart) plutôt que
de conclure d'une image.
