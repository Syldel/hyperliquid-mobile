import { IExchangePair } from '@syldel/trading-shared-types';

/**
 * Une paire telle que l'app la manipule.
 *
 * Strictement `IExchangePair` : ce qu'un formulaire produit se range dans
 * `IExchangeStrategy` — `rules` pour les champs `rule-builder`, `settings` pour
 * les scalaires — et non dans un champ propre au frontend. Un tel champ a
 * existé ici (`strategyParameters`) et n'était lu nulle part, si bien que les
 * valeurs saisies partaient telles quelles sur le compte utilisateur sans que
 * le bot sache les relire.
 *
 * L'alias reste nommé parce que la distinction « paire côté app » / « paire
 * côté configuration » a du sens à la lecture, et pour ne pas répandre
 * `IExchangePair` dans toutes les vues.
 */
export type TradingPair = IExchangePair;
