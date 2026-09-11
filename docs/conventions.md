# Conventions

## Purpose

Les usages de ce dépôt qui ne se devinent pas, et les pièges d'outillage qui coûtent une
demi-heure quand on ne les connaît pas. Les règles impératives tiennent dans
[../CLAUDE.md](../CLAUDE.md) ; ce document explique le pourquoi.

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

Le découpage se voit dans les tests : les 25 fichiers de spec portent presque tous sur du
domaine ou des utilitaires, jamais sur du rendu Ionic.

---

# Tests

`npx ng test --watch=false` — Vitest via `@angular/build:unit-test`.

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
