import { sortHand } from './cards';
import { getTableTop, legalCombos } from './rules';
import type {
  Card,
  GameSettings,
  GameState,
  PlayedSet,
  Phase,
  Role,
} from './types';

/**
 * Projection publique d'un joueur : jamais de cartes, uniquement un compteur.
 * C'est le seul objet transmis au sujet des adversaires.
 */
export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  cardCount: number;
  passed: boolean;
  finishPosition: number | null;
  role: Role | null;
  score: number;
}

export interface PublicTransfer {
  fromId: string;
  toId: string;
  count: number;
  mode: 'auto' | 'choice';
  done: boolean;
  /** Renseigné uniquement pour le donneur et le destinataire. */
  cardIds: string[] | null;
}

export interface PlayerView {
  phase: Phase;
  roundNumber: number;
  settings: GameSettings;
  players: PublicPlayer[];
  /** Main privée du destinataire de cette vue. */
  hand: Card[];
  youId: string | null;
  currentPlayerId: string | null;
  pile: PlayedSet[];
  requiredCount: number | null;
  lastPlayerId: string | null;
  finishOrder: string[];
  turnDeadline: number | null;
  /** Durée allouée au tour courant, pour un anneau de progression exact. */
  turnTotalMs: number | null;
  phaseEndsAt: number | null;
  exchange: { transfers: PublicTransfer[]; deadline: number | null } | null;
  mustOpenWithQueenOfSpades: boolean;
  /**
   * La valeur dominante vient d'être reposée : le joueur courant ne peut que
   * reposer cette même valeur, ou sauter son tour.
   */
  skipThreat: boolean;
  version: number;
  /** Identifiants des cartes jouables immédiatement (aide visuelle). */
  playableCardIds: string[];
  /** Horloge serveur : permet au client de corriger sa dérive pour le chrono. */
  serverNow: number;
}

function toPublic(state: GameState): PublicPlayer[] {
  return state.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seat: p.seat,
      isHost: p.isHost,
      isBot: p.isBot,
      connected: p.connected,
      cardCount: p.hand.length,
      passed: p.passed,
      finishPosition: p.finishPosition,
      role: p.role,
      score: p.score,
    }));
}

/** Cartes que le joueur peut inclure dans au moins une combinaison légale. */
function computePlayable(state: GameState, viewerId: string | null): string[] {
  if (!viewerId || state.phase !== 'playing') return [];
  if (state.currentPlayerId !== viewerId) return [];
  const player = state.players.find((p) => p.id === viewerId);
  if (!player || player.finishPosition !== null || player.passed) return [];
  const combos = legalCombos(player.hand, getTableTop(state), {
    allowEqualRank: state.settings.allowEqualRank,
    requireQueenOfSpades: state.mustOpenWithQueenOfSpades && state.pile.length === 0,
    exactRankOnly: state.skipThreat,
  });
  const ids = new Set<string>();
  for (const combo of combos) {
    // Toute carte de même valeur qu'une combinaison légale est sélectionnable.
    for (const card of player.hand) {
      if (card.rank === combo.rank) ids.add(card.id);
    }
  }
  if (state.mustOpenWithQueenOfSpades && state.pile.length === 0) {
    const queen = player.hand.find((c) => c.id === '12S');
    if (queen) {
      ids.clear();
      for (const card of player.hand) {
        if (card.rank === queen.rank) ids.add(card.id);
      }
    }
  }
  return Array.from(ids);
}

/**
 * Construit la vue destinée à un joueur donné.
 * Aucune main adverse ne traverse cette frontière.
 */
export function buildPlayerView(
  state: GameState,
  viewerId: string | null,
  now: number = Date.now(),
): PlayerView {
  const me = viewerId ? state.players.find((p) => p.id === viewerId) : undefined;

  const exchange = state.exchange
    ? {
        deadline: state.exchange.deadline,
        transfers: state.exchange.transfers.map((t) => ({
          fromId: t.fromId,
          toId: t.toId,
          count: t.count,
          mode: t.mode,
          done: t.cardIds !== null,
          cardIds:
            viewerId && (t.fromId === viewerId || t.toId === viewerId)
              ? t.cardIds
              : null,
        })),
      }
    : null;

  return {
    phase: state.phase,
    roundNumber: state.roundNumber,
    settings: state.settings,
    players: toPublic(state),
    hand: me ? sortHand(me.hand) : [],
    youId: me?.id ?? null,
    currentPlayerId: state.currentPlayerId,
    pile: state.pile.map<PlayedSet>((set) => ({ ...set, cards: set.cards.slice() })),
    requiredCount: state.requiredCount,
    lastPlayerId: state.lastPlayerId,
    finishOrder: state.finishOrder,
    turnDeadline: state.turnDeadline,
    turnTotalMs: state.turnTotalMs,
    phaseEndsAt: state.phaseEndsAt,
    exchange,
    mustOpenWithQueenOfSpades: state.mustOpenWithQueenOfSpades,
    skipThreat: state.skipThreat,
    version: state.version,
    playableCardIds: computePlayable(state, viewerId ?? null),
    serverNow: now,
  };
}
