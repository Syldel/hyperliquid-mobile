import { inject, Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';

/**
 * ============================================================================
 * LES TOASTS D'UN ENVOI D'ORDRE : UN SEUL TOAST, UNE LIGNE PAR ORDRE
 *
 * Un ordre limite avec un stop attaché produisait deux toasts, présentés au même endroit : Ionic les
 * empile l'un sur l'autre, et le second masquait le premier (téléphone, 2026-11-18). Et ils n'avaient
 * pas la même couleur que la modification d'un ordre : bleu pour un ordre posé, vert pour un ordre
 * rempli ou modifié.
 *
 * D'où ce service : chaque résultat est une **ligne**, et les lignes qui arrivent pendant qu'un toast
 * est visible le rejoignent au lieu de le recouvrir. Le toast est **vert si tout est passé, rouge dès
 * qu'une ligne a échoué**, et la ligne fautive est marquée ✕ : un échec parmi des succès ne se perd pas
 * dans un toast vert.
 *
 * Une ligne de succès tient sur une ligne à 360 px (`Stop Loss placed · OID 608610307710`, 37
 * caractères). Le texte d'un refus de l'exchange, lui, n'est jamais tronqué : il passe à la ligne.
 * ============================================================================
 */
export interface OrderToastLine {
  text: string;
  ok: boolean;
}

/** Ce que le toast montre pour ces lignes. Pur, pour être testé sans Ionic. */
export function orderToastView(lines: readonly OrderToastLine[]): {
  message: string;
  color: 'success' | 'danger';
} {
  const failed = lines.some((l) => !l.ok);
  return {
    message: lines.map((l) => (l.ok || lines.length === 1 ? l.text : `✕ ${l.text}`)).join('\n'),
    color: failed ? 'danger' : 'success',
  };
}

/** 3 s pour une ligne, une seconde de plus par ligne : le temps de lire ce qui s'est ajouté. */
const BASE_MS = 3000;
const PER_EXTRA_LINE_MS = 1000;

@Injectable({ providedIn: 'root' })
export class OrderToastService {
  private readonly toastCtrl = inject(ToastController);

  private lines: OrderToastLine[] = [];
  private current: HTMLIonToastElement | null = null;
  /** Chaque présentation porte un numéro : la fermeture d'un toast remplacé ne vide pas les lignes. */
  private generation = 0;

  success(text: string): void {
    this.add({ text, ok: true });
  }

  failure(text: string): void {
    this.add({ text, ok: false });
  }

  private add(line: OrderToastLine): void {
    this.lines = [...this.lines, line];
    void this.present();
  }

  private async present(): Promise<void> {
    const generation = ++this.generation;
    const previous = this.current;
    const { message, color } = orderToastView(this.lines);
    const toast = await this.toastCtrl.create({
      message,
      color,
      duration: BASE_MS + (this.lines.length - 1) * PER_EXTRA_LINE_MS,
      position: 'top',
      cssClass: 'order-toast',
      buttons: [{ icon: 'close-outline', role: 'cancel' }],
    });
    // Une ligne arrivée pendant la création : ce toast est déjà périmé, le suivant le remplace.
    if (generation !== this.generation) return;
    this.current = toast;
    toast.onDidDismiss().then(() => {
      if (generation === this.generation) {
        this.lines = [];
        this.current = null;
      }
    });
    await toast.present();
    // L'ancien toast part **après** que le nouveau est à l'écran : rien ne clignote entre les deux.
    if (previous) void previous.dismiss();
  }
}
