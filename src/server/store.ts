import { decideBotAction } from '@/game/bot';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  addPlayer,
  createGame,
  nextDeadline,
  reduce,
  removePlayer,
  setConnected,
} from '@/game/engine';
import type { GameAction, GameEvent, GameState, StampedEvent } from '@/game/types';
import { buildPlayerView } from '@/game/view';
import { generatePlayerId, generateRoomCode, generateToken } from './codes';
import { loadRoom, saveRoom } from './persistence';
import { redactEvent, type ServerMessage } from './protocol';

const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const EVENT_HISTORY = 80;
const BOT_MIN_DELAY = 750;
const BOT_MAX_DELAY = 1700;
const LOBBY_DROP_GRACE_MS = 12000;
/**
 * Délai avant de déclarer un joueur absent quand son flux se coupe.
 *
 * Une coupure de SSE est presque toujours une micro-coupure : onglet mis en
 * arrière-plan sur mobile, changement de réseau, proxy qui recycle la
 * connexion. Le client se reconnecte en quelques secondes. Sans ce délai, le
 * moindre creux réseau marquait le joueur hors ligne et ramenait son tour à
 * {@link DISCONNECTED_TURN_MS} — il passait tout seul avant d'avoir pu revenir.
 */
const PRESENCE_GRACE_MS = 10000;

export interface Subscriber {
  id: string;
  playerId: string | null;
  send: (message: ServerMessage) => void;
}

export interface Room {
  code: string;
  state: GameState;
  /** token secret → identifiant de joueur. Jamais transmis à un autre joueur. */
  tokens: Map<string, string>;
  subscribers: Set<Subscriber>;
  history: StampedEvent[];
  seq: number;
  updatedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  botTimer: ReturnType<typeof setTimeout> | null;
  dropTimers: Map<string, ReturnType<typeof setTimeout>>;
}

interface Registry {
  rooms: Map<string, Room>;
  sweeper: ReturnType<typeof setInterval> | null;
}

/**
 * Registre global : `globalThis` permet de survivre au rechargement à chaud de
 * Next.js en développement, sinon chaque édition de fichier viderait les salles.
 */
const globalRef = globalThis as unknown as { __presidentRegistry?: Registry };

const registry: Registry =
  globalRef.__presidentRegistry ??
  (globalRef.__presidentRegistry = { rooms: new Map(), sweeper: null });

if (!registry.sweeper) {
  registry.sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of registry.rooms) {
      if (room.subscribers.size === 0 && now - room.updatedAt > ROOM_TTL_MS) {
        clearRoomTimers(room);
        registry.rooms.delete(code);
      }
    }
  }, 5 * 60 * 1000);
  registry.sweeper.unref?.();
}

function clearRoomTimers(room: Room) {
  if (room.timer) clearTimeout(room.timer);
  if (room.botTimer) clearTimeout(room.botTimer);
  for (const timer of room.dropTimers.values()) clearTimeout(timer);
  room.dropTimers.clear();
  room.timer = null;
  room.botTimer = null;
}

/* ------------------------------------------------------------------ */
/* Cycle de vie des salles                                             */
/* ------------------------------------------------------------------ */

export function createRoom(settings?: Partial<GameState['settings']>): Room {
  let code = generateRoomCode();
  let guard = 0;
  while (registry.rooms.has(code) && guard++ < 50) code = generateRoomCode();

  const room: Room = {
    code,
    state: createGame({ settings }),
    tokens: new Map(),
    subscribers: new Set(),
    history: [],
    seq: 0,
    updatedAt: Date.now(),
    timer: null,
    botTimer: null,
    dropTimers: new Map(),
  };
  registry.rooms.set(code, room);
  return room;
}

/** Récupère une salle en mémoire, ou la restaure depuis Supabase si configuré. */
export async function findRoom(code: string): Promise<Room | undefined> {
  const existing = registry.rooms.get(code);
  if (existing) return existing;

  const restored = await loadRoom(code);
  if (!restored) return undefined;

  const room: Room = {
    code,
    state: restored.state,
    tokens: new Map(Object.entries(restored.tokens)),
    subscribers: new Set(),
    history: [],
    seq: 0,
    updatedAt: Date.now(),
    timer: null,
    botTimer: null,
    dropTimers: new Map(),
  };
  // Tout le monde est réputé déconnecté après une restauration.
  room.state = {
    ...room.state,
    players: room.state.players.map((p) => ({ ...p, connected: p.isBot })),
  };
  registry.rooms.set(code, room);
  schedule(room);
  return room;
}

export function playerIdForToken(room: Room, token: string | null): string | null {
  if (!token) return null;
  return room.tokens.get(token) ?? null;
}

/* ------------------------------------------------------------------ */
/* Mutations et diffusion                                              */
/* ------------------------------------------------------------------ */

function stamp(room: Room, events: GameEvent[]): StampedEvent[] {
  const at = Date.now();
  return events.map((event) => ({ seq: ++room.seq, at, event }));
}

export function broadcast(room: Room, events: StampedEvent[]) {
  const now = Date.now();
  for (const subscriber of room.subscribers) {
    const view = buildPlayerView(room.state, subscriber.playerId, now);
    const redacted = events.map((e) => ({
      ...e,
      event: redactEvent(e.event, subscriber.playerId),
    }));
    subscriber.send({ type: 'sync', view, events: redacted, seq: room.seq });
  }
}

/** Applique une mutation, journalise ses événements, diffuse et replanifie. */
export function commit(room: Room, events: GameEvent[]) {
  const stamped = stamp(room, events);
  room.history.push(...stamped);
  if (room.history.length > EVENT_HISTORY) {
    room.history.splice(0, room.history.length - EVENT_HISTORY);
  }
  room.updatedAt = Date.now();
  broadcast(room, stamped);
  schedule(room);
  void saveRoom(room.code, room.state, Object.fromEntries(room.tokens));
}

export function dispatch(room: Room, action: GameAction): GameEvent[] {
  const result = reduce(room.state, action, Date.now());
  room.state = result.state;
  commit(room, result.events);
  return result.events;
}

/* ------------------------------------------------------------------ */
/* Planification : chrono serveur + bots                               */
/* ------------------------------------------------------------------ */

function schedule(room: Room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = null;

  const deadline = nextDeadline(room.state);
  if (deadline !== null) {
    const delay = Math.max(30, deadline - Date.now() + 40);
    room.timer = setTimeout(() => {
      room.timer = null;
      const result = reduce(room.state, { type: 'tick' }, Date.now());
      room.state = result.state;
      commit(room, result.events);
    }, delay);
    room.timer.unref?.();
  }

  scheduleBot(room);
}

function scheduleBot(room: Room) {
  const { state } = room;
  let botId: string | null = null;

  if (state.phase === 'playing' && state.currentPlayerId) {
    const current = state.players.find((p) => p.id === state.currentPlayerId);
    if (current?.isBot) botId = current.id;
  } else if (state.phase === 'exchange' && state.exchange) {
    const pending = state.exchange.transfers.find(
      (t) => t.cardIds === null && t.mode === 'choice',
    );
    const donor = pending && state.players.find((p) => p.id === pending.fromId);
    if (donor?.isBot) botId = donor.id;
  }

  if (!botId) return;

  const delay = BOT_MIN_DELAY + Math.random() * (BOT_MAX_DELAY - BOT_MIN_DELAY);
  const targetId = botId;
  const versionAtSchedule = state.version;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.state.version !== versionAtSchedule) return;
    const action = decideBotAction(room.state, targetId);
    if (!action) return;
    const result = reduce(room.state, action, Date.now());
    if (result.state.version === room.state.version) return;
    room.state = result.state;
    commit(room, result.events);
  }, delay);
  room.botTimer.unref?.();
}

/* ------------------------------------------------------------------ */
/* Joueurs                                                             */
/* ------------------------------------------------------------------ */

export interface JoinOutcome {
  ok: true;
  token: string;
  playerId: string;
}
export interface JoinFailure {
  ok: false;
  error: string;
}

export function joinRoom(
  room: Room,
  name: string,
  avatar: string,
): JoinOutcome | JoinFailure {
  if (room.state.phase !== 'lobby') {
    return { ok: false, error: 'La partie a déjà commencé.' };
  }
  if (room.state.players.length >= MAX_PLAYERS) {
    return { ok: false, error: `La table est complète (${MAX_PLAYERS} joueurs).` };
  }

  const playerId = generatePlayerId();
  const token = generateToken();
  room.tokens.set(token, playerId);
  room.state = addPlayer(room.state, { id: playerId, name, avatar });
  commit(room, []);
  return { ok: true, token, playerId };
}

export function addBot(room: Room, requesterId: string | null): string | null {
  const host = room.state.players.find((p) => p.isHost);
  if (!host || host.id !== requesterId) return 'Seul l’hôte peut ajouter un bot.';
  if (room.state.phase !== 'lobby') return 'La partie a déjà commencé.';
  if (room.state.players.length >= MAX_PLAYERS) return 'La table est complète.';

  const botNames = ['Ada', 'Bolt', 'Cléo', 'Dune', 'Écho', 'Faro', 'Gus', 'Hex'];
  const botAvatars = ['🤖', '👾', '🦾', '🛸', '🧿', '🎲', '🪐', '⚡'];
  const index = room.state.players.filter((p) => p.isBot).length;
  const id = `bot_${generatePlayerId().slice(3)}`;
  room.state = addPlayer(room.state, {
    id,
    name: botNames[index % botNames.length],
    avatar: botAvatars[index % botAvatars.length],
    isBot: true,
  });
  commit(room, []);
  return null;
}

export function kickPlayer(room: Room, requesterId: string | null, targetId: string) {
  const host = room.state.players.find((p) => p.isHost);
  if (!host || host.id !== requesterId) return 'Seul l’hôte peut retirer un joueur.';
  if (room.state.phase !== 'lobby') return 'Impossible en cours de partie.';
  if (targetId === requesterId) return 'Vous ne pouvez pas vous retirer vous-même.';
  room.state = removePlayer(room.state, targetId);
  for (const [token, playerId] of room.tokens) {
    if (playerId === targetId) room.tokens.delete(token);
  }
  commit(room, []);
  return null;
}

/**
 * Départ volontaire. Dans le salon, la place est libérée immédiatement ;
 * en cours de partie le joueur reste à table (il peut revenir), mais il est
 * marqué hors ligne pour que son tour n'immobilise pas les autres.
 */
export function leaveRoom(room: Room, playerId: string) {
  if (room.state.phase === 'lobby') {
    room.state = removePlayer(room.state, playerId);
    for (const [token, id] of room.tokens) {
      if (id === playerId) room.tokens.delete(token);
    }
  } else {
    room.state = setConnected(room.state, playerId, false);
  }
  commit(room, []);
  return null;
}

export function updateSettings(
  room: Room,
  requesterId: string | null,
  settings: Partial<GameState['settings']>,
) {
  const host = room.state.players.find((p) => p.isHost);
  if (!host || host.id !== requesterId) return 'Seul l’hôte peut modifier les réglages.';
  if (room.state.phase !== 'lobby') return 'Réglages verrouillés en cours de partie.';

  const turnSeconds = clamp(settings.turnSeconds ?? room.state.settings.turnSeconds, 10, 120);
  const rounds = clamp(settings.rounds ?? room.state.settings.rounds, 1, 10);
  room.state = {
    ...room.state,
    version: room.state.version + 1,
    settings: {
      turnSeconds,
      rounds,
      allowEqualRank: settings.allowEqualRank ?? room.state.settings.allowEqualRank,
      skipOnEqual: settings.skipOnEqual ?? room.state.settings.skipOnEqual,
    },
  };
  commit(room, []);
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function canStart(room: Room): boolean {
  return room.state.phase === 'lobby' && room.state.players.length >= MIN_PLAYERS;
}

/* ------------------------------------------------------------------ */
/* Présence                                                            */
/* ------------------------------------------------------------------ */

export function attach(room: Room, subscriber: Subscriber) {
  room.subscribers.add(subscriber);
  if (subscriber.playerId) {
    clearPresenceTimeout(room, subscriber.playerId);
    const before = room.state;
    room.state = setConnected(room.state, subscriber.playerId, true);
    if (before !== room.state) commit(room, []);
  }
  const view = buildPlayerView(room.state, subscriber.playerId, Date.now());
  subscriber.send({ type: 'sync', view, events: [], seq: room.seq });
}

/**
 * Signale qu'un joueur est bel et bien là, sans passer par le flux temps réel.
 *
 * Le mode secours du client (instantanés toutes les 2,5 s) et chacune de ses
 * actions passent par ici : sans cela, un joueur qui joue par ce chemin serait
 * déclaré absent au bout du délai de grâce, et son tour raccourci à
 * {@link DISCONNECTED_TURN_MS} alors qu'il est devant son écran.
 */
export function touchPresence(room: Room, playerId: string | null) {
  if (!playerId) return;
  const before = room.state;
  room.state = setConnected(room.state, playerId, true);
  if (before !== room.state) commit(room, []);
  // La présence par instantanés est un bail qui s'épuise : sans nouvelle
  // manifestation, le joueur redevient absent au bout du délai de grâce.
  // Un flux temps réel ouvert, lui, se suffit à lui-même.
  if (hasStream(room, playerId)) clearPresenceTimeout(room, playerId);
  else armPresenceTimeout(room, playerId);
}

export function detach(room: Room, subscriber: Subscriber) {
  room.subscribers.delete(subscriber);
  const playerId = subscriber.playerId;
  if (!playerId) return;
  if (hasStream(room, playerId)) return;
  // On laisse au client le temps de se reconnecter avant de l'annoncer absent.
  armPresenceTimeout(room, playerId);
}

function hasStream(room: Room, playerId: string): boolean {
  return Array.from(room.subscribers).some((s) => s.playerId === playerId);
}

function clearPresenceTimeout(room: Room, playerId: string) {
  const pending = room.dropTimers.get(playerId);
  if (!pending) return;
  clearTimeout(pending);
  room.dropTimers.delete(playerId);
}

function armPresenceTimeout(room: Room, playerId: string) {
  clearPresenceTimeout(room, playerId);
  const timer = setTimeout(() => {
    room.dropTimers.delete(playerId);
    if (hasStream(room, playerId)) return;
    room.state = setConnected(room.state, playerId, false);
    commit(room, []);
    scheduleLobbyDrop(room, playerId);
  }, PRESENCE_GRACE_MS);
  timer.unref?.();
  room.dropTimers.set(playerId, timer);
}

/** Dans le salon d'attente, un joueur parti pour de bon libère sa place. */
function scheduleLobbyDrop(room: Room, playerId: string) {
  if (room.state.phase !== 'lobby') return;
  const timer = setTimeout(() => {
    room.dropTimers.delete(playerId);
    const player = room.state.players.find((p) => p.id === playerId);
    if (!player || player.connected) return;
    room.state = removePlayer(room.state, playerId);
    for (const [token, id] of room.tokens) {
      if (id === playerId) room.tokens.delete(token);
    }
    commit(room, []);
  }, LOBBY_DROP_GRACE_MS);
  timer.unref?.();
  room.dropTimers.set(playerId, timer);
}
