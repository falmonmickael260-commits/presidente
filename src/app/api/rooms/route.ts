import { buildPlayerView } from '@/game/view';
import {
  jsonError,
  readJson,
  sanitizeAvatar,
  sanitizeName,
  sanitizeSettings,
  sanitizeToken,
} from '@/server/input';
import { verifyPlatformToken } from '@/server/platform-token';
import { createRoom, joinRoom } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Crée une salle et y installe son hôte. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const name = sanitizeName(body.name);
  if (!name) return jsonError('Choisissez un pseudo de 2 à 16 caractères.', 400);

  const identity = verifyPlatformToken(sanitizeToken(body.rgToken));
  const room = createRoom(sanitizeSettings(body.settings));
  const joined = joinRoom(room, name, sanitizeAvatar(body.avatar), identity?.uid ?? null);
  if (!joined.ok) return jsonError(joined.error, 409);

  return Response.json({
    code: room.code,
    token: joined.token,
    playerId: joined.playerId,
    view: buildPlayerView(room.state, joined.playerId, Date.now()),
  });
}
