import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vérifie le jeton d'identité signé par la coquille Revanche Game (même
 * secret des deux côtés — voir PLATFORM_SHARED_SECRET). Rien n'est jamais
 * fait confiance sans vérification de signature : un jeton invalide ou
 * expiré retombe silencieusement sur un joueur invité, comme aujourd'hui.
 */
export interface PlatformIdentity {
  uid: string;
  username: string;
}

export function verifyPlatformToken(token: unknown): PlatformIdentity | null {
  if (typeof token !== 'string') return null;
  const secret = process.env.PLATFORM_SHARED_SECRET;
  if (!secret) return null;

  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expected = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      uid?: unknown;
      username?: unknown;
      exp?: unknown;
    };
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (typeof payload.uid !== 'string' || typeof payload.username !== 'string') return null;
    return { uid: payload.uid, username: payload.username };
  } catch {
    return null;
  }
}
