# Ordre au marché et fermeture de position

Ajoutés le 2026-11-12. Avant, le mobile n'avait ni ordre au marché ni fermeture : `isPriceInvalid`
interdisait de croiser le carnet, et l'utilisateur a dû ouvrir une position BTC sur l'interface
d'Hyperliquid pendant une mesure en réel. Le code vit dans
`src/app/features/secure/open-orders/market-order/`.

## Ce qui part, et pourquoi sous cette forme

**Un seul IOC, au prix plafond `mid × (1 ± glissement maximal)`**, arrondi sur la grille des perps.
C'est la forme du SDK Python officiel (`exchange.py`, `market_open` / `market_close`, lu en brut
le 2026-11-12) : `_slippage_price` sur `all_mids`, puis `{"limit": {"tif": "Ioc"}}`.

| Décision                                        | Pourquoi                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST hyperliquid/order`, pas `/orders/instant` | `/orders/instant` relance un IOC sans contrepartie jusqu'à six fois, 7,5 s d'écart, à un nouveau prix chaque fois : un comportement de bot. Un bouton envoie un ordre.        |
| le **mid** comme référence                      | celui du SDK. Pris dans `l2Book` et non dans `allMids`, pour que mid, spread et parcours du carnet viennent de la même photographie.                                          |
| glissement par défaut **1 %**, réglable         | 0,2 % (le gateway) laisse un BTC agité sans exécution ; 5 % (le SDK) accepte trop. Bornes 0,05 – 10 % : 10 % est la tolérance d'Hyperliquid pour ses propres TP/SL au marché. |
| confirmation **toujours**, sans option          | décidé avec l'utilisateur. Elle montre le prix plafond qui partira, exactement.                                                                                               |
| perps seulement                                 | un spot n'a ni mark ni oracle.                                                                                                                                                |
| jamais de relance                               | un réseau coupé ou un 5xx est un **état inconnu** : la position est relue une fois, montrée, et rien n'est renvoyé.                                                           |

Le réglage du glissement est mémorisé sous `app_hl_market_max_slippage_pct`, partagé par le
formulaire et la fermeture.

## La confirmation

Elle lit `l2Book` (poids 2) et `metaAndAssetCtxs` du dex (poids 20) **une fois** à l'ouverture,
et le taux taker du compte (`userFees`) une fois par session.

**Elle ne presse pas** (revu le 2026-11-12, avec l'utilisateur). La première version faisait
défiler l'âge de la lecture (« Market read 7 s ago »), le passait en rouge à 10 s et désactivait
Confirm : un compte qui court pousse à valider sans lire. Un compte à rebours a été écarté pour la
même raison, en pire.

- L'heure de la lecture s'affiche, fixe : « Prices as of 14:32:05 ». Passé 10 s, une ligne grise
  ajoute « Re-read when you confirm ».
- **Confirm reste actif.** Sur une lecture de plus de 10 s, il **relit** le marché, une fois. L'ordre
  ne part sans nouveau geste que si ce qu'on a lu tient : le prix plafond n'a pas bougé de plus de
  **0,1 %** et le verdict n'a pas empiré (`market-recheck.util.ts`). Sinon rien ne part, la feuille
  dit ce qui a changé (« worst price 2040.3 → 2045.1; risk OK → Caution »), les chiffres concernés
  sont soulignés, et il faut confirmer de nouveau.
- Confirm reste inactif **1 s** après chaque changement des chiffres, et les boutons sont dans un
  pied fixe : rien ne bouge sous un doigt déjà en route.

⚠️ Les seuils de 0,1 % et 1 s sont des choix, pas des mesures. La relecture au moment de confirmer
est couverte par `market-order-confirm.component.spec.ts`, **pas éprouvée dans le navigateur** :
dans le vrai formulaire, Confirm envoie l'ordre. L'affichage (heure, ligne grise, avis « changed »
posé à la main, pied fixe) l'est, à 360 px dans les deux thèmes, le 2026-11-12.

Elle affiche le mid, le prix plafond, le prix moyen estimé (parcours du carnet pour cette
taille), la valeur, les frais taker, et en ouverture le funding et le prix de liquidation estimé.

### Le verdict de risque d'exécution

**Le pire critère décide**, il n'y a pas de somme pondérée : un bon volume ne masque pas un
carnet vide. Une donnée absente est « unknown » et compte comme une prudence. Le verdict
n'empêche rien : un « High » est un message rouge (décidé le 2026-11-12).

| Critère                      | Prudence |   Élevé |
| ---------------------------- | -------: | ------: |
| impact estimé (moyen vs mid) |    0,1 % |   0,5 % |
| part remplissable            |        — | < 100 % |
| spread                       |    0,1 % |   0,5 % |
| mid vs mark                  |    0,2 % |     1 % |
| mark vs oracle               |    0,5 % |     2 % |
| part du volume sur 24 h      |      1 % |     5 % |

⚠️ Ces seuils sont des points de départ : ni la doc d'Hyperliquid ni le SDK n'en donnent. Au-delà
des 20 niveaux visibles du carnet, la profondeur est « unknown », jamais « vide ».

La volatilité n'y est pas : elle juge un stop, pas une exécution d'une seconde (retirée le
2026-11-12).

### Le prix de liquidation estimé

La formule de `trading/liquidations.md`, en **marge isolée seulement**, sans position déjà
ouverte sur la paire, dans le premier palier de marge. Sinon « not estimated », avec la raison.
⚠️ Non vérifié : si les frais taker se prélèvent sur la marge isolée.

## Les protections d'un ordre au marché

**Posées après l'exécution**, dimensionnées sur la taille **remplie** et ancrées sur le prix
**moyen obtenu** : comme Freqtrade (« placed on the exchange immediately after buy order fills »,
`stoploss.md`) et comme le bot (`hl-protection.service.ts`). Le groupe `normalTpsl` est écarté :
d'après la doc, ses enfants ne sont posés que si le parent est **entièrement** rempli, donc un
IOC rempli en partie laisserait la part remplie nue.

Si une protection échoue, le formulaire **ne se ferme pas** : « Position open — not protected »,
et un bouton « Retry protection » qui ne repose que celles qui manquent, une fois par appui.

## Les garde-fous du formulaire

Des ordres valides pour Hyperliquid, mais probablement pas voulus (`open-form/order-guards.util.ts`).
**Des avertissements, jamais des blocages** (décidé le 2026-11-12) : le serveur reste juge, et un
cas inhabituel doit rester possible. Ce qui est certainement faux (un limite du mauvais côté, un
ordre sous 10 $) est bloqué ailleurs.

|     | Cas                                                                                                                     | Ce qui est dit                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| G1  | un **Close Limit qui croise le marché** : `isPriceInvalid` ignore les reduce-only, il s'exécute donc aussitôt, en taker | « fills now, as a taker, down to X. Use Close › Market for that »                                                                 |
| G2  | un ordre **de sens opposé à la position**, sans reduce-only                                                             | en gris s'il la réduit ou la ferme ; en avertissement s'il la **retourne** (« Closes your short 0.0343 AND opens a long 0.0157 ») |
| G3  | une **marge supérieure au capital disponible**, en comptant la marge que libère la position fermée au passage           | « Needs ≈ X $ of margin at 3x, Y $ available »                                                                                    |
| G4  | un **glissement maximal au-delà de 3 %** (formulaire et feuille de fermeture)                                           | « accepts a price up to X % away from the mid »                                                                                   |

La position vient d'une lecture de `clearinghouseState` (poids 2) à chaque changement de paire,
**quel que soit le type d'ordre**. La lecture de position existante ne se faisait que pour un
déclencheur : mesuré le 2026-11-12 sur un short ETH de 0,0343, un achat qui le réduisait passait
pour une ouverture, G2 se taisait et G3 annonçait une marge qu'il ne demandait pas.

⚠️ G3 est une approximation : frais exclus, capital affiché `total − used` du gateway et non
l'`availableToTrade` d'Hyperliquid, réservation de marge d'un ordre limite en attente non mesurée.
Le seuil de G4 (3 %) est un choix. Contrastes mesurés à 360 px : 5,43:1 (jaune) et 6,37:1 (gris) en
clair, 8,68:1 et 6,0:1 en sombre.

## La fermeture depuis la carte d'une position

`Close › Market` : 25 / 50 / 75 / 100 % ou une taille libre, IOC reduce-only du côté opposé, même
confirmation. Les TP/SL de la paire sont **listés, jamais modifiés** (décidé le 2026-11-12), avec
ce que la fermeture leur fait. `Close › Limit` ouvre le formulaire d'ordre prérempli (sens de
clôture, taille de la position, reduce-only), bouton « Close long » / « Close short ».

## Mesuré en réel, et ce qui reste ouvert

Mesuré le 2026-11-12 par l'utilisateur (l'agent ne passe jamais d'ordre) :

- l'achat au marché, et les protections posées 0,89 s après l'exécution sur le prix moyen obtenu ;
- l'annulation des stops de taille fixe à la milliseconde d'une fermeture totale, trois fois (BTC
  long deux fois, ETH short une fois, par `Close › Market` à 100 %) ;
- le refus d'une fermeture partielle reduce-only **à 2,2 $** (un point) ;
- l'acceptation **à la pose** d'un Stop Market qui vaut 9,65 $ à sa borne.

Voir [roadmap.md](roadmap.md#à-éprouver-en-réel--ce-quaucun-double-ne-peut-établir), points 7 à 10.

⚠️ Reste ouvert :

- la forme d'un IOC rempli en partie (point 6) ;
- le seuil d'une fermeture partielle entre 2,2 et 10 $ : le blocage à 10 $ est une supposition
  (point 8) ;
- la fermeture à 100 % d'une position qui vaut déjà moins de 10 $ ;
- l'exécution, **au déclenchement**, d'un stop au marché qui vaut moins de 10 $ à sa borne
  (point 9) : s'il est refusé alors, `notionalPrice` laisse poser un stop qui ne protège pas ;
- l'annulation d'un TP/SL « de position » par une fermeture totale ;
- les frais sur la marge isolée.
