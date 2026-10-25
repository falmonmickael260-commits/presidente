import { buildPlayerView } from '@/game/view';
import { normalizeRoomCode } from '@/server/codes';
import {
  jsonError,
  readJson,
  sanitizeAvatar,
  sanitizeName,
  sanitizeToken,
} from '@/server/input';
import { verifyPlatformToken } from '@/server/platform-token';
import { findRoom, joinRoom } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const room = await findRoom(normalizeRoomCode(code));
  if (!room) return jsonError("Cette salle n'existe pas ou a expiré.", 404);

  const body = await readJson(request);
  const name = sanitizeName(body.name);
  if (!name) return jsonError('Choisissez un pseudo de 2 à 16 caractères.', 400);

  const identity = verifyPlatformToken(sanitizeToken(body.rgToken));
  const joined = joinRoom(room, name, sanitizeAvatar(body.avatar), identity?.uid ?? null);
  if (!joined.ok) return jsonError(joined.error, 409);

  return Response.json({
    code: room.code,
    token: joined.token,
    playerId: joined.playerId,
    view: buildPlayerView(room.state, joined.playerId, Date.now()),
  });
}
