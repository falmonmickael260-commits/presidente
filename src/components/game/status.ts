import { comboLabel } from '@/game/cards';
import type { TableTop } from '@/game/rules';
import type { PlayerView, PublicPlayer, PublicTransfer } from '@/game/view';
import { PHASE_LABELS } from './tableLayout';

/**
 * Phrase d'état affichée au joueur.
 * Elle doit répondre en un coup d'œil à « qui joue et que dois-je faire ? ».
 */
export function buildStatusText({
  view,
  me,
  currentPlayer,
  isYourTurn,
  mustPlayQueen,
  tableTop,
  pendingTransfer,
}: {
  view: PlayerView;
  me: PublicPlayer | null;
  currentPlayer: PublicPlayer | null;
  isYourTurn: boolean;
  mustPlayQueen: boolean;
  tableTop: TableTop | null;
  pendingTransfer: PublicTransfer | null;
}): string {
  if (view.phase === 'dealing') return 'Distribution des cartes…';

  if (view.phase === 'exchange') {
    if (pendingTransfer) {
      const target = view.players.find((p) => p.id === pendingTransfer.toId);
      const plural = pendingTransfer.count > 1 ? 's' : '';
      return `Donnez ${pendingTransfer.count} carte${plural} à ${target?.name ?? 'votre adversaire'}`;
    }
    return 'Échange des cartes en cours…';
  }

  if (view.phase !== 'playing') return PHASE_LABELS[view.phase];

  if (me && me.finishPosition !== null) return 'Vous avez terminé — la manche continue';

  if (isYourTurn) {
    if (mustPlayQueen) return 'À vous — posez la Dame de pique';
    // Sous la menace, dire exactement ce qui reste possible évite de chercher.
    if (view.skipThreat && tableTop) {
      return `${comboLabel(tableTop.rank, tableTop.count)} ou vous sautez votre tour`;
    }
    if (!tableTop) return 'À vous — repartez comme vous voulez';
    return 'À vous de jouer';
  }

  if (view.skipThreat && tableTop) {
    const who = currentPlayer?.name ?? 'Le joueur suivant';
    return `${who} doit reposer ${comboLabel(tableTop.rank, tableTop.count)} ou sauter`;
  }

  return `Au tour ${withElision(currentPlayer?.name)}`;
}

/** « Au tour d'Alice » plutôt que « Au tour de Alice ». */
function withElision(name: string | undefined): string {
  if (!name) return 'de …';
  return /^[aeiouyàâäéèêëîïôöùûüh]/i.test(name) ? `d’${name}` : `de ${name}`;
}
