// Shared source for every game adapter. Never imported by browser code.
import { createHmac, timingSafeEqual, createCipheriv, createHash, randomBytes } from 'node:crypto';

async function limitedText(request) {
  const reader = request.body?.getReader(), chunks = []; let size = 0;
  if (!reader) return '';
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new Error('Commande trop volumineuse.'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function contextResponse(request, game, adapter) {
  try {
    const raw = await limitedText(request);
    if (raw.length > 8192) throw new Error('Envoi invalide.');
    const { session, identity } = JSON.parse(raw);
    const key = process.env.PLATFORM_SHARED_SECRET;
    const parts = typeof identity === 'string' ? identity.split('.') : [];
    if (!key) throw new Error('Invitations indisponibles.');
    let user = null;
    if (identity) {
      if (parts.length !== 2) throw new Error('Identité invalide.');
      const expected = createHmac('sha256', key).update(parts[0]).digest('base64url');
      if (parts[1].length !== expected.length || !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) throw new Error('Identité invalide.');
      user = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      if (!user.uid || typeof user.exp !== 'number' || user.exp < Date.now() / 1000) throw new Error('Relance le jeu depuis Revanche Games pour renouveler ta connexion.');
    }
    const room = await adapter.inspect({ v: 1, game, operation: 'inspect', room: session.code, uid: user?.uid || '', name: user?.username || '', proof: session });
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(`rg-game-context-v1:${key}`).digest(), iv);
    const plain = JSON.stringify({ game, session, uid: user?.uid || room.ownerUid || null, exp: Math.floor(Date.now() / 1000) + 120 });
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const context = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    return Response.json({ context }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invitation indisponible.' }, { status: 403 }); }
}

export function verifyCommand(raw, signature, game, key = process.env.PLATFORM_SHARED_SECRET, now = Date.now()) {
  if (!key || typeof signature !== 'string' || raw.length > 8192) throw new Error('Autorisation de plateforme absente.');
  const parts = signature.split('.');
  if (parts.length !== 2 || !/^\d{10}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]) || Math.abs(now / 1000 - Number(parts[0])) > 30) throw new Error('Autorisation de plateforme expirée.');
  const expected = createHmac('sha256', key).update(`rg-connector-v1.${parts[0]}.${raw}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(parts[1], 'hex'))) throw new Error('Signature de plateforme invalide.');
  const command = JSON.parse(raw);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (command.v !== 1 || command.game !== game || !['inspect', 'admit'].includes(command.operation) ||
      !uuid.test(command.uid) || typeof command.name !== 'string' || command.name.length > 100 ||
      typeof command.room !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(command.room) ||
      !command.proof || command.proof.code !== command.room ||
      (command.operation === 'admit' && (!uuid.test(command.invitation) || !uuid.test(command.inviter) || typeof command.instance !== 'string'))) throw new Error('Commande de plateforme invalide.');
  return command;
}

export async function connectorResponse(request, game, adapter) {
  try {
    if (request.method !== 'POST') return Response.json({ error: 'Méthode refusée.' }, { status: 405 });
    const raw = await limitedText(request);
    let c;
    try { c = verifyCommand(raw, request.headers.get('x-rg-signature'), game); }
    catch { return Response.json({ error: 'Autorisation de plateforme invalide.' }, { status: 403 }); }
    const room = await adapter.inspect(c);
    if (c.operation === 'inspect') return Response.json({ room }, { headers: { 'cache-control': 'no-store' } });
    if (room.instance !== c.instance) throw new Error('Ce salon a fermé ou a été remplacé.');
    // The adapter rechecks capacity at its atomic native join operation.
    const session = await adapter.admit(c);
    return Response.json({ room, session }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Entrée impossible.' }, { status: 409, headers: { 'cache-control': 'no-store' } });
  }
}

export async function nodeConnector(req, res, game, adapter) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (!['/api/platform/connector', '/api/platform/context'].includes(pathname)) return false;
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 8192) { res.writeHead(413); res.end(); return true; } chunks.push(chunk); }
  const request = new Request('http://localhost' + pathname, {
    method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
  });
  const response = await (pathname.endsWith('/context') ? contextResponse : connectorResponse)(request, game, adapter);
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return true;
}
