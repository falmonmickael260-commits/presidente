import { validatePass, validatePlay, validateSkip } from '@/game/rules';
import { buildPlayerView } from '@/game/view';
import { normalizeRoomCode } from '@/server/codes';
import { jsonError, readJson, sanitizeCardIds, sanitizeSettings } from '@/server/input';
import {
  addBot,
  canStart,
  dispatch,
  findRoom,
  kickPlayer,
  leaveRoom,
  playerIdForToken,
  touchPresence,
  updateSettings,
  type Room,
} from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Point d'entrée unique des actions joueur.
 * Le jeton n'est jamais utilisé pour déduire des droits autres que l'identité :
 * toute autorisation est revalidée contre l'état serveur.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const room = await findRoom(normalizeRoomCode(code));
  if (!room) return jsonError("Cette salle n'existe pas ou a expiré.", 404);

  const body = await readJson(request);
  const token = typeof body.token === 'string' ? body.token : null;
  const playerId = playerIdForToken(room, token);
  if (!playerId) return jsonError('Session invalide. Rejoignez la salle à nouveau.', 401);
  if (!room.state.players.some((p) => p.id === playerId)) {
    return jsonError("Vous ne faites plus partie de cette table.", 401);
  }

  // Jouer un coup prouve la présence, même si le flux temps réel est tombé.
  touchPresence(room, playerId);

  const action = typeof body.action === 'string' ? body.action : '';
  const error = handle(room, playerId, action, body);
  if (error) return jsonError(error, 400);

  return Response.json({
    ok: true,
    view: buildPlayerView(room.state, playerId, Date.now()),
  });
}

function handle(
  room: Room,
  playerId: string,
  action: string,
  body: Record<string, unknown>,
): string | null {
  switch (action) {
    case 'start_game': {
      if (!canStart(room)) return 'Il faut au moins 3 joueurs pour commencer.';
      dispatch(room, { type: 'start_game', playerId });
      return room.state.phase === 'lobby' ? 'Seul l’hôte peut lancer la partie.' : null;
    }

    case 'play': {
      const cardIds = sanitizeCardIds(body.cardIds);
      if (!cardIds) return 'Sélection de cartes invalide.';
      const check = validatePlay(room.state, playerId, cardIds);
      if (!check.ok) return check.message;
      dispatch(room, { type: 'play', playerId, cardIds });
      return null;
    }

    case 'pass': {
      const check = validatePass(room.state, playerId);
      if (!check.ok) return check.message;
      dispatch(room, { type: 'pass', playerId });
      return null;
    }

    case 'skip': {
      const check = validateSkip(room.state, playerId);
      if (!check.ok) return check.message;
      dispatch(room, { type: 'skip', playerId });
      return null;
    }

    case 'exchange_give': {
      const cardIds = sanitizeCardIds(body.cardIds);
      if (!cardIds) return 'Sélection de cartes invalide.';
      const before = room.state.version;
      dispatch(room, { type: 'exchange_give', playerId, cardIds });
      return room.state.version === before ? 'Échange impossible avec ces cartes.' : null;
    }

    case 'next_round': {
      const before = room.state.version;
      dispatch(room, { type: 'next_round', playerId });
      return room.state.version === before ? 'Manche suivante indisponible.' : null;
    }

    case 'restart': {
      const before = room.state.version;
      dispatch(room, { type: 'restart', playerId });
      return room.state.version === before ? 'Relance indisponible.' : null;
    }

    case 'leave':
      return leaveRoom(room, playerId);

    case 'add_bot':
      return addBot(room, playerId);

    case 'kick': {
      const targetId = typeof body.targetId === 'string' ? body.targetId : '';
      if (!targetId) return 'Joueur introuvable.';
      return kickPlayer(room, playerId, targetId);
    }

    case 'settings':
      return updateSettings(room, playerId, sanitizeSettings(body.settings));

    default:
      return 'Action inconnue.';
  }
}
