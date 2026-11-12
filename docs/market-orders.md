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
et le taux taker du compte (`userFees`) une fois par session. Passé 10 s, l'envoi exige une
relecture : un plafond calculé sur un mid périmé ne protège plus rien.

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

## La fermeture depuis la carte d'une position

`Close › Market` : 25 / 50 / 75 / 100 % ou une taille libre, IOC reduce-only du côté opposé, même
confirmation. Les TP/SL de la paire sont **listés, jamais modifiés** (décidé le 2026-11-12), avec
ce que la fermeture leur fait. `Close › Limit` ouvre le formulaire d'ordre prérempli (sens de
clôture, taille de la position, reduce-only), bouton « Close long » / « Close short ».

## Mesuré en réel, et ce qui reste ouvert

Mesuré le 2026-11-12 par l'utilisateur (l'agent ne passe jamais d'ordre) : l'achat au marché,
les protections posées 0,89 s après l'exécution sur le prix moyen obtenu, le refus d'une
fermeture partielle sous 10 $ (désormais bloquée), et l'annulation des stops à la milliseconde
d'une fermeture totale. Voir [roadmap.md](roadmap.md#à-éprouver-en-réel--ce-quaucun-double-ne-peut-établir),
points 7 à 10.

⚠️ Reste ouvert : la forme d'un IOC rempli en partie (point 6), la fermeture à 100 % d'une
position qui vaut déjà moins de 10 $, et les frais sur la marge isolée.
