import { QUEEN_OF_SPADES, createDeck, deal, sortHand } from './cards';
import { createRng, nextSeed, shuffle } from './rng';
import {
  bestCards,
  findPlayer,
  getTableTop,
  isCarreOnTable,
  legalCombos,
  validatePass,
  validatePlay,
  validateSkip,
  worstCards,
} from './rules';
import type {
  CardId,
  ExchangeTransfer,
  GameAction,
  GameEvent,
  GameSettings,
  GameState,
  Player,
  Role,
  StandingEntry,
} from './types';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/** Durée de l'animation de distribution, pendant laquelle la table est verrouillée. */
export const DEAL_MS = 2600;
/** Durée de la séquence de résultats avant la manche suivante. */
export const ROUND_END_MS = 12000;
/** Un joueur déconnecté ne bloque pas la table : son tour expire plus vite. */
export const DISCONNECTED_TURN_MS = 6000;

export const DEFAULT_SETTINGS: GameSettings = {
  turnSeconds: 30,
  allowEqualRank: true,
  skipOnEqual: true,
  rounds: 3,
};

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}

/* ------------------------------------------------------------------ */
/* Création / lobby                                                    */
/* ------------------------------------------------------------------ */

export function createGame(options?: {
  settings?: Partial<GameSettings>;
  seed?: number;
  now?: number;
}): GameState {
  return {
    phase: 'lobby',
    roundNumber: 0,
    players: [],
    settings: { ...DEFAULT_SETTINGS, ...options?.settings },
    currentPlayerId: null,
    pile: [],
    requiredCount: null,
    lastPlayerId: null,
    finishOrder: [],
    exchange: null,
    turnDeadline: null,
    turnTotalMs: null,
    phaseEndsAt: null,
    version: 0,
    seed: options?.seed ?? ((Date.now() & 0x7fffffff) || 1),
    mustOpenWithQueenOfSpades: true,
    skipThreat: false,
    createdAt: options?.now ?? Date.now(),
  };
}

export function addPlayer(
  state: GameState,
  player: { id: string; name: string; avatar: string; isBot?: boolean },
): GameState {
  if (state.players.length >= MAX_PLAYERS) return state;
  if (state.players.some((p) => p.id === player.id)) return state;
  const next: Player = {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    seat: state.players.length,
    isHost: state.players.length === 0,
    isBot: player.isBot ?? false,
    connected: true,
    hand: [],
    passed: false,
    finishPosition: null,
    role: null,
    score: 0,
  };
  return bump({ ...state, players: [...state.players, next] });
}

export function removePlayer(state: GameState, playerId: string): GameState {
  const players = state.players
    .filter((p) => p.id !== playerId)
    .map((p, index) => ({ ...p, seat: index }));
  if (players.length > 0 && !players.some((p) => p.isHost)) {
    players[0] = { ...players[0], isHost: true };
  }
  return bump({ ...state, players });
}

export function setConnected(
  state: GameState,
  playerId: string,
  connected: boolean,
): GameState {
  if (!state.players.some((p) => p.id === playerId && p.connected !== connected)) {
    return state;
  }
  return bump({
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
  });
}

function bump(state: GameState): GameState {
  return { ...state, version: state.version + 1 };
}

/* ------------------------------------------------------------------ */
/* Rôles et classement                                                 */
/* ------------------------------------------------------------------ */

export function roleForPosition(position: number, playerCount: number): Role {
  if (position === 0) return 'president';
  if (position === playerCount - 1) return 'trou_du_cul';
  if (playerCount >= 4) {
    if (position === 1) return 'vice_president';
    if (position === playerCount - 2) return 'vice_trou';
  }
  return 'neutre';
}

export function pointsForPosition(position: number, playerCount: number): number {
  return playerCount - position;
}

/* ------------------------------------------------------------------ */
/* Helpers de tour                                                     */
/* ------------------------------------------------------------------ */

const isActive = (p: Player) => p.finishPosition === null;
const isInTrick = (p: Player) => isActive(p) && !p.passed;

function bySeat(players: readonly Player[]): Player[] {
  return players.slice().sort((a, b) => a.seat - b.seat);
}

function nextPlayerAfter(
  state: GameState,
  fromPlayerId: string,
  predicate: (p: Player) => boolean,
): string | null {
  const ordered = bySeat(state.players);
  const startIndex = ordered.findIndex((p) => p.id === fromPlayerId);
  if (startIndex === -1) {
    const fallback = ordered.find(predicate);
    return fallback ? fallback.id : null;
  }
  for (let step = 1; step <= ordered.length; step++) {
    const candidate = ordered[(startIndex + step) % ordered.length];
    if (predicate(candidate)) return candidate.id;
  }
  return null;
}

function turnDurationFor(state: GameState, playerId: string): number {
  const player = findPlayer(state, playerId);
  return player && !player.connected && !player.isBot
    ? DISCONNECTED_TURN_MS
    : state.settings.turnSeconds * 1000;
}

function setTurn(
  state: GameState,
  playerId: string | null,
  now: number,
  events: GameEvent[],
): GameState {
  if (!playerId) {
    return { ...state, currentPlayerId: null, turnDeadline: null, turnTotalMs: null };
  }
  const total = turnDurationFor(state, playerId);
  const deadline = now + total;
  events.push({ type: 'turn', playerId, deadline });
  return { ...state, currentPlayerId: playerId, turnDeadline: deadline, turnTotalMs: total };
}

/* ------------------------------------------------------------------ */
/* Démarrage de manche                                                 */
/* ------------------------------------------------------------------ */

export function startRound(state: GameState, now: number): ReduceResult {
  const events: GameEvent[] = [];
  const rng = createRng(state.seed);
  const deck = shuffle(createDeck(), rng);
  const hands = deal(deck, state.players.length);
  const roundNumber = state.roundNumber + 1;

  const players = bySeat(state.players).map((p, index) => ({
    ...p,
    hand: hands[index],
    passed: false,
    finishPosition: null,
  }));

  const perPlayer: Record<string, number> = {};
  for (const p of players) perPlayer[p.id] = p.hand.length;

  const next: GameState = {
    ...state,
    phase: 'dealing',
    roundNumber,
    players,
    pile: [],
    requiredCount: null,
    lastPlayerId: null,
    finishOrder: [],
    exchange: null,
    currentPlayerId: null,
    turnDeadline: null,
    turnTotalMs: null,
    phaseEndsAt: now + DEAL_MS,
    seed: nextSeed(state.seed),
    mustOpenWithQueenOfSpades: roundNumber === 1,
    skipThreat: false,
  };

  events.push({ type: 'round_start', roundNumber, hands: perPlayer });
  events.push({ type: 'deal', roundNumber, perPlayer });
  return { state: bump(next), events };
}

/** Qui ouvre la manche : porteur de la Dame de pique en manche 1, Président ensuite. */
function openingPlayerId(state: GameState): string {
  if (state.roundNumber === 1) {
    const holder = state.players.find((p) =>
      p.hand.some((c) => c.id === QUEEN_OF_SPADES),
    );
    if (holder) return holder.id;
  }
  const president = state.players.find((p) => p.role === 'president');
  if (president) return president.id;
  return bySeat(state.players)[0].id;
}

/* ------------------------------------------------------------------ */
/* Échange de cartes                                                   */
/* ------------------------------------------------------------------ */

function buildTransfers(state: GameState): ExchangeTransfer[] {
  const byRole = (role: Role) => state.players.find((p) => p.role === role);
  const president = byRole('president');
  const trou = byRole('trou_du_cul');
  const vice = byRole('vice_president');
  const viceTrou = byRole('vice_trou');

  const transfers: ExchangeTransfer[] = [];
  if (president && trou && president.id !== trou.id) {
    transfers.push({
      fromId: trou.id,
      toId: president.id,
      count: 2,
      mode: 'auto',
      cardIds: null,
    });
    transfers.push({
      fromId: president.id,
      toId: trou.id,
      count: 2,
      mode: 'choice',
      cardIds: null,
    });
  }
  if (vice && viceTrou && vice.id !== viceTrou.id) {
    transfers.push({
      fromId: viceTrou.id,
      toId: vice.id,
      count: 1,
      mode: 'auto',
      cardIds: null,
    });
    transfers.push({
      fromId: vice.id,
      toId: viceTrou.id,
      count: 1,
      mode: 'choice',
      cardIds: null,
    });
  }
  return transfers;
}

function applyTransfer(
  players: Player[],
  transfer: ExchangeTransfer,
  cardIds: CardId[],
): Player[] {
  const ids = new Set(cardIds);
  const from = players.find((p) => p.id === transfer.fromId);
  if (!from) return players;
  const moved = from.hand.filter((c) => ids.has(c.id));
  return players.map((p) => {
    if (p.id === transfer.fromId) {
      return { ...p, hand: p.hand.filter((c) => !ids.has(c.id)) };
    }
    if (p.id === transfer.toId) {
      return { ...p, hand: sortHand([...p.hand, ...moved]) };
    }
    return p;
  });
}

function beginExchangeOrPlay(state: GameState, now: number): ReduceResult {
  const events: GameEvent[] = [];
  const transfers = state.roundNumber > 1 ? buildTransfers(state) : [];

  if (transfers.length === 0) {
    return startPlaying(state, now, events);
  }

  events.push({ type: 'exchange_start' });

  let players = state.players;
  const resolved: ExchangeTransfer[] = [];
  for (const transfer of transfers) {
    if (transfer.mode !== 'auto') {
      resolved.push(transfer);
      continue;
    }
    const from = players.find((p) => p.id === transfer.fromId);
    if (!from) {
      resolved.push({ ...transfer, cardIds: [] });
      continue;
    }
    const cardIds = bestCards(from.hand, transfer.count).map((c) => c.id);
    players = applyTransfer(players, transfer, cardIds);
    resolved.push({ ...transfer, cardIds });
    events.push({
      type: 'exchange_transfer',
      fromId: transfer.fromId,
      toId: transfer.toId,
      count: transfer.count,
      cardIds,
    });
  }

  const next: GameState = {
    ...state,
    phase: 'exchange',
    players,
    exchange: { transfers: resolved, deadline: now + state.settings.turnSeconds * 1000 },
    currentPlayerId: null,
    turnDeadline: null,
    turnTotalMs: null,
    phaseEndsAt: null,
  };

  if (resolved.every((t) => t.cardIds !== null)) {
    return startPlaying(next, now, events);
  }

  // Les bots donnent leurs cartes via le planificateur, avec un délai humain :
  // l'échange reste visible à l'écran au lieu de se résoudre instantanément.
  return { state: bump(next), events };
}

function commitExchange(
  state: GameState,
  fromId: string,
  cardIds: CardId[],
  now: number,
  events: GameEvent[],
): ReduceResult {
  const exchange = state.exchange;
  if (!exchange) return { state, events };
  const index = exchange.transfers.findIndex(
    (t) => t.fromId === fromId && t.cardIds === null,
  );
  if (index === -1) return { state, events };
  const transfer = exchange.transfers[index];

  const players = applyTransfer(state.players, transfer, cardIds);
  const transfers = exchange.transfers.slice();
  transfers[index] = { ...transfer, cardIds };

  events.push({
    type: 'exchange_transfer',
    fromId: transfer.fromId,
    toId: transfer.toId,
    count: transfer.count,
    cardIds,
  });

  const next: GameState = { ...state, players, exchange: { ...exchange, transfers } };
  if (transfers.every((t) => t.cardIds !== null)) {
    return startPlaying(next, now, events);
  }
  return { state: next, events };
}

function startPlaying(
  state: GameState,
  now: number,
  events: GameEvent[],
): ReduceResult {
  const opening = openingPlayerId(state);
  let next: GameState = {
    ...state,
    phase: 'playing',
    exchange: null,
    phaseEndsAt: null,
    pile: [],
    requiredCount: null,
    lastPlayerId: null,
    skipThreat: false,
    players: state.players.map((p) => ({ ...p, passed: false })),
  };
  next = setTurn(next, opening, now, events);
  return { state: bump(next), events };
}

/* ------------------------------------------------------------------ */
/* Déroulement du jeu                                                  */
/* ------------------------------------------------------------------ */

function closeTrick(
  state: GameState,
  winnerId: string,
  reason: 'all_passed' | 'carre' | 'alone',
  now: number,
  events: GameEvent[],
): ReduceResult {
  events.push({ type: 'trick_won', playerId: winnerId, reason });

  let next: GameState = {
    ...state,
    pile: [],
    requiredCount: null,
    lastPlayerId: null,
    skipThreat: false,
    players: state.players.map((p) => ({ ...p, passed: false })),
  };

  const winner = findPlayer(next, winnerId);
  const leadId =
    winner && isActive(winner)
      ? winnerId
      : nextPlayerAfter(next, winnerId, isActive);

  if (!leadId) return { state: bump({ ...next, currentPlayerId: null }), events };
  next = setTurn(next, leadId, now, events);
  return { state: bump(next), events };
}

function endRound(state: GameState, now: number, events: GameEvent[]): ReduceResult {
  // Le joueur restant occupe la dernière place.
  const finishOrder = state.finishOrder.slice();
  for (const p of bySeat(state.players)) {
    if (!finishOrder.includes(p.id)) finishOrder.push(p.id);
  }

  const count = state.players.length;
  const standings: StandingEntry[] = finishOrder.map((playerId, position) => ({
    playerId,
    position,
    role: roleForPosition(position, count),
    points: pointsForPosition(position, count),
  }));

  const roleById = new Map(standings.map((s) => [s.playerId, s.role]));
  const pointsById = new Map(standings.map((s) => [s.playerId, s.points]));

  const players = state.players.map((p) => ({
    ...p,
    role: roleById.get(p.id) ?? null,
    score: p.score + (pointsById.get(p.id) ?? 0),
    finishPosition: finishOrder.indexOf(p.id),
    passed: false,
  }));

  const isLastRound = state.roundNumber >= state.settings.rounds;

  const next: GameState = {
    ...state,
    phase: isLastRound ? 'game_over' : 'round_end',
    players,
    finishOrder,
    pile: [],
    requiredCount: null,
    lastPlayerId: null,
    currentPlayerId: null,
    turnDeadline: null,
    turnTotalMs: null,
    phaseEndsAt: isLastRound ? null : now + ROUND_END_MS,
    mustOpenWithQueenOfSpades: false,
    skipThreat: false,
  };

  events.push({ type: 'round_end', standings });
  if (isLastRound) {
    const ranking = players
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((p, index) => ({
        playerId: p.id,
        position: index,
        role: roleForPosition(index, count),
        points: p.score,
      }));
    events.push({ type: 'game_over', standings: ranking });
  }
  return { state: bump(next), events };
}

function afterMove(state: GameState, actorId: string, now: number, events: GameEvent[]) {
  const activeCount = state.players.filter(isActive).length;
  if (activeCount <= 1) {
    return endRound(state, now, events);
  }

  if (isCarreOnTable(state)) {
    const top = getTableTop(state);
    if (top) {
      events.push({ type: 'carre', playerId: actorId, rank: top.rank });
    }
    return closeTrick(state, actorId, 'carre', now, events);
  }

  const owner = state.lastPlayerId;
  const contenders = state.players.filter((p) => isInTrick(p) && p.id !== owner);

  if (owner && contenders.length === 0) {
    const activeOthers = state.players.filter((p) => isActive(p) && p.id !== owner);
    return closeTrick(
      state,
      owner,
      activeOthers.length === 0 ? 'alone' : 'all_passed',
      now,
      events,
    );
  }

  const nextId = nextPlayerAfter(state, actorId, isInTrick);
  if (!nextId) {
    if (owner) return closeTrick(state, owner, 'all_passed', now, events);
    return { state: bump({ ...state, currentPlayerId: null }), events };
  }
  return { state: bump(setTurn(state, nextId, now, events)), events };
}

function doPlay(
  state: GameState,
  playerId: string,
  cardIds: CardId[],
  now: number,
): ReduceResult {
  const check = validatePlay(state, playerId, cardIds);
  if (!check.ok) return { state, events: [] };

  const events: GameEvent[] = [];
  const ids = new Set(cardIds);
  const combo = check.combo;
  const setId = `${state.version}-${playerId}-${state.pile.length}`;
  // Valeur à battre AVANT cette pose : c'est elle qui décide du saut.
  const previousTop = getTableTop(state);

  let players = state.players.map((p) =>
    p.id === playerId ? { ...p, hand: p.hand.filter((c) => !ids.has(c.id)) } : p,
  );

  const isQueenOpening = state.mustOpenWithQueenOfSpades && state.pile.length === 0;

  events.push({
    type: 'play',
    playerId,
    cards: combo.cards,
    combo: combo.kind,
    setId,
    isQueenOpening,
  });

  let next: GameState = {
    ...state,
    players,
    pile: [
      ...state.pile,
      {
        id: setId,
        playerId,
        cards: combo.cards,
        rank: combo.rank,
        order: state.pile.length,
      },
    ],
    requiredCount: state.requiredCount ?? combo.count,
    lastPlayerId: playerId,
    mustOpenWithQueenOfSpades: false,
    // Reposer la même valeur fait sauter le joueur suivant, à moins qu'il ne
    // repose lui aussi cette valeur — auquel cas le saut glisse d'un cran.
    // La règle ne vaut que pour les cartes seules : sur les paires et les
    // brelans on joue normalement, et quatre cartes de même valeur ferment
    // le pli (carré), ce qui se substitue au saut.
    skipThreat:
      state.settings.skipOnEqual &&
      previousTop !== null &&
      previousTop.count === 1 &&
      combo.count === 1 &&
      combo.rank === previousTop.rank,
  };

  const actor = findPlayer(next, playerId);
  if (actor && actor.hand.length === 0) {
    const position = next.finishOrder.length;
    const role = roleForPosition(position, next.players.length);
    players = next.players.map((p) =>
      p.id === playerId ? { ...p, finishPosition: position, passed: false } : p,
    );
    next = { ...next, players, finishOrder: [...next.finishOrder, playerId] };
    events.push({ type: 'player_finished', playerId, position, role });
  }

  return afterMove(next, playerId, now, events);
}

/** Le joueur sous menace laisse filer son tour : il reste dans le pli. */
function doSkip(state: GameState, playerId: string, now: number): ReduceResult {
  const check = validateSkip(state, playerId);
  if (!check.ok) return { state, events: [] };

  // La menace n'existe que si une valeur est sur la table : `top` est non nul.
  const top = getTableTop(state);
  if (!top) return { state, events: [] };
  const events: GameEvent[] = [{ type: 'skipped', playerId, rank: top.rank }];
  return afterMove({ ...state, skipThreat: false }, playerId, now, events);
}

function doPass(state: GameState, playerId: string, now: number): ReduceResult {
  const check = validatePass(state, playerId);
  if (!check.ok) return { state, events: [] };

  const events: GameEvent[] = [{ type: 'pass', playerId }];
  const next: GameState = {
    ...state,
    skipThreat: false,
    players: state.players.map((p) => (p.id === playerId ? { ...p, passed: true } : p)),
  };
  return afterMove(next, playerId, now, events);
}

/** Coup automatique à l'expiration du chrono : passer, ou poser le plus faible coup légal. */
export function autoMoveFor(state: GameState, playerId: string): GameAction {
  const player = findPlayer(state, playerId);
  const top = getTableTop(state);
  if (!player) return { type: 'pass', playerId };
  if (state.skipThreat) return { type: 'skip', playerId };
  if (top) return { type: 'pass', playerId };
  const options = legalCombos(player.hand, null, {
    allowEqualRank: state.settings.allowEqualRank,
    requireQueenOfSpades: state.mustOpenWithQueenOfSpades,
  });
  const choice = options[0];
  if (!choice) return { type: 'pass', playerId };
  return { type: 'play', playerId, cardIds: choice.cards.map((c) => c.id) };
}

/* ------------------------------------------------------------------ */
/* Réducteur principal                                                 */
/* ------------------------------------------------------------------ */

export function reduce(
  state: GameState,
  action: GameAction,
  now: number = Date.now(),
): ReduceResult {
  switch (action.type) {
    case 'start_game': {
      const player = findPlayer(state, action.playerId);
      if (!player?.isHost) return { state, events: [] };
      if (state.phase !== 'lobby') return { state, events: [] };
      if (state.players.length < MIN_PLAYERS) return { state, events: [] };
      return startRound(state, now);
    }

    case 'play':
      return doPlay(state, action.playerId, action.cardIds, now);

    case 'pass':
      return doPass(state, action.playerId, now);

    case 'skip':
      return doSkip(state, action.playerId, now);

    case 'exchange_give': {
      if (state.phase !== 'exchange' || !state.exchange) return { state, events: [] };
      const transfer = state.exchange.transfers.find(
        (t) => t.fromId === action.playerId && t.cardIds === null && t.mode === 'choice',
      );
      if (!transfer) return { state, events: [] };
      const donor = findPlayer(state, action.playerId);
      if (!donor) return { state, events: [] };
      const unique = Array.from(new Set(action.cardIds));
      if (unique.length !== transfer.count) return { state, events: [] };
      if (!unique.every((id) => donor.hand.some((c) => c.id === id))) {
        return { state, events: [] };
      }
      const events: GameEvent[] = [];
      const result = commitExchange(state, action.playerId, unique, now, events);
      return { state: bump(result.state), events: result.events };
    }

    case 'next_round': {
      if (state.phase !== 'round_end') return { state, events: [] };
      const player = findPlayer(state, action.playerId);
      if (!player?.isHost) return { state, events: [] };
      return startRound(state, now);
    }

    case 'restart': {
      if (state.phase !== 'game_over') return { state, events: [] };
      const player = findPlayer(state, action.playerId);
      if (!player?.isHost) return { state, events: [] };
      return {
        state: bump({
          ...state,
          phase: 'lobby',
          roundNumber: 0,
          players: state.players.map((p) => ({
            ...p,
            hand: [],
            passed: false,
            finishPosition: null,
            role: null,
            score: 0,
          })),
          pile: [],
          requiredCount: null,
          lastPlayerId: null,
          finishOrder: [],
          exchange: null,
          currentPlayerId: null,
          turnDeadline: null,
          turnTotalMs: null,
          phaseEndsAt: null,
          mustOpenWithQueenOfSpades: true,
          skipThreat: false,
        }),
        events: [],
      };
    }

    case 'tick':
      return tick(state, now);

    default:
      return { state, events: [] };
  }
}

/** Fait avancer les transitions temporisées : distribution, chrono, fin de manche. */
export function tick(state: GameState, now: number): ReduceResult {
  const events: GameEvent[] = [];

  if (state.phase === 'dealing' && state.phaseEndsAt !== null && now >= state.phaseEndsAt) {
    return beginExchangeOrPlay({ ...state, phaseEndsAt: null }, now);
  }

  if (state.phase === 'exchange' && state.exchange?.deadline && now >= state.exchange.deadline) {
    let current = state;
    for (const transfer of state.exchange.transfers) {
      if (transfer.cardIds !== null) continue;
      const donor = findPlayer(current, transfer.fromId);
      if (!donor) continue;
      const cardIds = worstCards(donor.hand, transfer.count).map((c) => c.id);
      const result = commitExchange(current, transfer.fromId, cardIds, now, events);
      current = result.state;
      if (current.phase !== 'exchange') break;
    }
    return { state: bump(current), events };
  }

  if (state.phase === 'round_end' && state.phaseEndsAt !== null && now >= state.phaseEndsAt) {
    return startRound(state, now);
  }

  if (
    state.phase === 'playing' &&
    state.currentPlayerId &&
    state.turnDeadline !== null &&
    now >= state.turnDeadline
  ) {
    const playerId = state.currentPlayerId;
    events.push({ type: 'timeout', playerId });
    const auto = autoMoveFor(state, playerId);
    const result = reduce(state, auto, now);
    return { state: result.state, events: [...events, ...result.events] };
  }

  return { state, events };
}

/** Prochaine échéance connue de la machine d'état (pilote le planificateur serveur). */
export function nextDeadline(state: GameState): number | null {
  if (state.phase === 'dealing' || state.phase === 'round_end') return state.phaseEndsAt;
  if (state.phase === 'exchange') return state.exchange?.deadline ?? null;
  if (state.phase === 'playing') return state.turnDeadline;
  return null;
}
