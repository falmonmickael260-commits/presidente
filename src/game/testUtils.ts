import { parseCardId, sortHand } from './cards';
import { addPlayer, createGame, reduce, startRound } from './engine';
import type { Card, GameState } from './types';

export const AVATARS = ['🐺', '🦊', '🐼', '🦁', '🐸', '🐙', '🦉', '🐝'];

export function cards(...ids: string[]): Card[] {
  return ids.map((id) => {
    const card = parseCardId(id);
    if (!card) throw new Error(`Carte invalide: ${id}`);
    return card;
  });
}

export function gameWithPlayers(count: number, seed = 1): GameState {
  let state = createGame({ seed, settings: { turnSeconds: 30, rounds: 3 } });
  for (let i = 0; i < count; i++) {
    state = addPlayer(state, { id: `p${i}`, name: `Joueur ${i}`, avatar: AVATARS[i] });
  }
  return state;
}

/** Démarre une manche puis force des mains précises, pour des scénarios déterministes. */
export function playingGame(
  hands: Record<string, string[]>,
  options?: {
    startWith?: string;
    allowEqualRank?: boolean;
    skipOnEqual?: boolean;
    roundNumber?: number;
  },
): GameState {
  const ids = Object.keys(hands);
  let state = gameWithPlayers(ids.length);
  if (options?.allowEqualRank !== undefined) {
    state = { ...state, settings: { ...state.settings, allowEqualRank: options.allowEqualRank } };
  }
  if (options?.skipOnEqual !== undefined) {
    state = { ...state, settings: { ...state.settings, skipOnEqual: options.skipOnEqual } };
  }
  const started = startRound(state, 0).state;
  let next: GameState = {
    ...started,
    phase: 'playing',
    roundNumber: options?.roundNumber ?? 1,
    mustOpenWithQueenOfSpades: false,
    players: started.players.map((p, index) => ({
      ...p,
      id: ids[index],
      hand: sortHand(cards(...hands[ids[index]])),
      passed: false,
      finishPosition: null,
    })),
    pile: [],
    requiredCount: null,
    lastPlayerId: null,
    finishOrder: [],
    currentPlayerId: options?.startWith ?? ids[0],
    turnDeadline: 100000,
    phaseEndsAt: null,
  };
  return next;
}

export function play(state: GameState, playerId: string, ...cardIds: string[]) {
  return reduce(state, { type: 'play', playerId, cardIds }, 1000);
}

export function pass(state: GameState, playerId: string) {
  return reduce(state, { type: 'pass', playerId }, 1000);
}

export function skip(state: GameState, playerId: string) {
  return reduce(state, { type: 'skip', playerId }, 1000);
}
