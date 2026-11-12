import type { RiskVerdict } from './market-risk.util';

/**
 * ============================================================================
 * Ce qui a changé entre deux lectures du marché, du point de vue de celui qui confirme.
 *
 * La confirmation ne presse plus (décidé le 2026-11-12, avec l'utilisateur) : l'âge de la lecture
 * ne défile plus, et le bouton Confirm reste actif. Une lecture trop vieille est **relue au moment
 * de confirmer** ; l'ordre ne part alors sans nouvelle confirmation que si ce qu'on a lu tient
 * encore. Un compte à rebours a été écarté : il rend l'échéance plus visible encore, et pousse à
 * valider avant zéro — le défaut qu'on corrigeait.
 *
 * « Tient encore » : le verdict n'est pas pire, et le prix plafond n'a pas bougé de plus de
 * `RECHECK_PRICE_TOLERANCE`. ⚠️ Ce seuil est un CHOIX, large à dessein, pas une mesure : au-delà,
 * on redemande, et redemander ne coûte qu'un geste.
 * ============================================================================
 */

/** 0,1 % du prix plafond. */
export const RECHECK_PRICE_TOLERANCE = 0.001;

/** Après un changement des chiffres, Confirm reste inactif ce temps-là : un doigt déjà en route
 * ne valide pas des chiffres qu'il n'a pas vus. */
export const CONFIRM_SETTLE_MS = 1000;

export interface ConfirmedFigures {
  worstPx: string;
  verdict: RiskVerdict;
}

export interface FigureChange {
  id: 'worst-price' | 'verdict';
  text: string;
}

const VERDICT_RANK: Record<RiskVerdict, number> = { ok: 0, caution: 1, high: 2 };
const VERDICT_LABEL: Record<RiskVerdict, string> = { ok: 'OK', caution: 'Caution', high: 'High' };

/**
 * Les changements qui obligent à reconfirmer, vides si ce qu'on a lu tient encore. Un verdict qui
 * S'AMÉLIORE n'en est pas un : il ne rend pas l'ordre plus risqué que ce qu'on a accepté.
 */
export function figureChanges(before: ConfirmedFigures, after: ConfirmedFigures): FigureChange[] {
  const changes: FigureChange[] = [];
  const was = Number(before.worstPx);
  const now = Number(after.worstPx);
  if (!(was > 0) || !(now > 0) || Math.abs(now - was) / was > RECHECK_PRICE_TOLERANCE) {
    changes.push({
      id: 'worst-price',
      text: `worst price ${before.worstPx} → ${after.worstPx}`,
    });
  }
  if (VERDICT_RANK[after.verdict] > VERDICT_RANK[before.verdict]) {
    changes.push({
      id: 'verdict',
      text: `risk ${VERDICT_LABEL[before.verdict]} → ${VERDICT_LABEL[after.verdict]}`,
    });
  }
  return changes;
}
