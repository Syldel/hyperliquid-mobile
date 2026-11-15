/**
 * L'âge des bougies affichées : d'où il vient, ce qu'il prouve, comment il se dit.
 *
 * Deux chemins remplissent le chart, et chacun connaît l'heure de ses bougies à sa façon :
 * - **`/analysis`** (surcouches attachées) : le bot rend `candlesAgeMs`, l'âge de ses bougies au moment
 *   où il assemble sa réponse, mesuré sur **sa** propre horloge. On en déduit l'heure de lecture sur
 *   l'horloge du téléphone, `reçu à − candlesAgeMs`, sans jamais comparer les deux horloges — qui
 *   peuvent différer de plusieurs secondes, ou de bien plus sur un téléphone mal réglé ;
 * - **bougies nues** (Hyperliquid directement) : l'heure de lecture est celle du téléphone, rangée avec
 *   l'entrée du cache (`HyperliquidCandleService.getCandlesWithTime`).
 *
 * Le transit n'est pas compté : une réponse qui met 300 ms à arriver fait paraître les bougies 300 ms
 * plus jeunes qu'elles ne sont. Sans effet à l'échelle de ce qu'on affiche, la seconde.
 */

/**
 * Âge au-delà duquel une lecture demandée **fraîche** ne l'a pas été.
 *
 * Une relecture suivie d'effet rend un âge de l'ordre du temps de calcul du bot après la lecture : les
 * indicateurs, les backtests, un `meta` de dex HIP-3 — de l'ordre de la seconde au pire. Le cache qu'on voulait éviter, lui, a jusqu'à un quart
 * d'intervalle : 15 min en 1H. Dix secondes séparent largement les deux cas ; une marge large plutôt
 * qu'une mesure fine, le chiffre ne change aucune décision.
 */
export const FRESH_READ_MAX_AGE_MS = 10_000;

/**
 * L'heure de lecture des bougies d'une réponse `/analysis`, sur l'horloge du téléphone — ou `null` si le
 * bot ne l'a pas dite.
 *
 * `candlesAgeMs` est obligatoire dans les types partagés depuis 0.35.0, mais un bot plus ancien ne
 * l'envoie pas, et le type ne vérifie rien à l'exécution : d'où `unknown`. Un nombre négatif ou non fini
 * n'est pas un âge ; il se traite comme une absence plutôt que de dater des bougies dans le futur.
 */
export function analysisCandlesReadAt(receivedAt: number, candlesAgeMs: unknown): number | null {
  if (typeof candlesAgeMs !== 'number' || !Number.isFinite(candlesAgeMs) || candlesAgeMs < 0) {
    return null;
  }
  return receivedAt - candlesAgeMs;
}

/**
 * Une lecture demandée fraîche a-t-elle été servie depuis un cache ?
 *
 * C'est ce qui rend `fresh` vérifiable : sans cette comparaison, un bot qui ignorerait la demande
 * laisserait le bouton de rafraîchissement afficher des bougies de 15 min comme si elles venaient d'être
 * lues.
 */
export function freshReadWasIgnored(
  askedFresh: boolean,
  readAt: number,
  receivedAt: number,
  maxAgeMs = FRESH_READ_MAX_AGE_MS,
): boolean {
  return askedFresh && receivedAt - readAt > maxAgeMs;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * « 21:45:12 », ou « 14 Nov 23:10 » si la lecture n'est pas d'aujourd'hui — en heure locale. Affichée
 * derrière une icône d'horloge, sur la ligne du prix : d'où un texte court, sans « as of ».
 *
 * Une heure plutôt qu'un âge (« 3 min ago ») : un âge vieillit pendant que l'écran reste ouvert, et
 * l'afficher juste demanderait une horloge qui tourne. Une heure reste vraie sans rien recalculer. Les
 * secondes, parce qu'un rafraîchissement forcé dans la même minute doit se voir.
 *
 * La date s'ajoute dès que le jour diffère : le cache des bougies 1D vit jusqu'à 6 h et peut franchir
 * minuit, et « 23:10 » lu à 01:00 se prendrait pour l'heure d'hier soir… ou de ce soir. Sans les
 * secondes alors : elles ne disent plus rien sur une lecture de la veille, et la place manque.
 */
export function formatCandlesReadAt(readAt: number, now: number): string {
  const read = new Date(readAt);
  const today = new Date(now);
  const hhmm = `${pad(read.getHours())}:${pad(read.getMinutes())}`;
  const sameDay =
    read.getFullYear() === today.getFullYear() &&
    read.getMonth() === today.getMonth() &&
    read.getDate() === today.getDate();
  return sameDay
    ? `${hhmm}:${pad(read.getSeconds())}`
    : `${read.getDate()} ${MONTHS[read.getMonth()]} ${hhmm}`;
}
