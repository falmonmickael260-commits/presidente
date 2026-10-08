import { buildPlayerView } from '@/game/view';
import { normalizeRoomCode } from '@/server/codes';
import { jsonError } from '@/server/input';
import { findRoom, playerIdForToken, touchPresence } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Instantané de la vue d'un joueur.
 * Sert de filet de sécurité quand le flux temps réel est indisponible
 * (proxy filtrant le SSE, onglet réveillé après une longue veille).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const room = await findRoom(normalizeRoomCode(code));
  if (!room) return jsonError("Cette salle n'existe pas ou a expiré.", 404);

  const token = new URL(request.url).searchParams.get('token');
  const playerId = playerIdForToken(room, token);
  // Demander son état, c'est être là : le mode secours du client vaut présence.
  touchPresence(room, playerId);
  return Response.json({ view: buildPlayerView(room.state, playerId, Date.now()) });
}
