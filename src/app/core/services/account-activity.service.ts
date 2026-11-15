import { Injectable, signal } from '@angular/core';

/** Une écriture envoyée au compte : ce qu'elle était, et quand elle s'est terminée. */
export interface AccountWrite {
  kind: 'place' | 'modify' | 'cancel';
  /** Date de fin de l'appel, réussi ou non. */
  at: number;
}

/**
 * Le compte vient de recevoir une écriture : les lectures déjà faites ne le décrivent plus.
 *
 * Pourquoi un service à part, et pas un appel direct au cache des ordres depuis le gateway :
 * `HyperliquidCacheService` lance ses trois lectures **dès sa construction**. L'injecter dans
 * `HyperliquidGatewayService` les aurait déclenchées à chaque formulaire d'ordre, même pour qui n'ouvre
 * jamais de chart. Ici, un compteur ; le cache, s'il existe, s'y abonne.
 *
 * Avant ce service, aucune écriture ne prévenait le chart : un ordre modifié depuis Open Orders restait
 * dessiné à son ancien prix au retour sur watchlist-detail, qui reste vivant dans la pile Ionic.
 */
@Injectable({ providedIn: 'root' })
export class AccountActivityService {
  private readonly _lastWrite = signal<AccountWrite | null>(null);

  /** La dernière écriture terminée — un nouvel objet à chaque fois, donc chaque écriture notifie. */
  readonly lastWrite = this._lastWrite.asReadonly();

  record(kind: AccountWrite['kind']): void {
    this._lastWrite.set({ kind, at: Date.now() });
  }
}
