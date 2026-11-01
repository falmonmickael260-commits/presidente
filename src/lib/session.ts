export interface StoredSession {
  code: string;
  token: string;
  playerId: string;
}

export interface Identity {
  name: string;
  avatar: string;
}

const SESSION_PREFIX = 'president:session:';
const IDENTITY_KEY = 'president:identity';
const memory = new Map<string, string>();

function safeGet(key: string): string | null {
  try {
    return memory.get(key) ?? window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* navigation privée : la session reste en mémoire uniquement */
  }
}

/** La session d'une salle survit à un rafraîchissement : c'est la clé de la reconnexion. */
export function loadSession(code: string): StoredSession | null {
  if (typeof window === 'undefined') return null;
  const raw = safeGet(SESSION_PREFIX + code);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.token && parsed.playerId ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession) {
  if (typeof window === 'undefined') return;
  safeSet(SESSION_PREFIX + session.code, JSON.stringify(session));
  window.dispatchEvent(new Event('rg:session'));
}

export function clearSession(code: string) {
  memory.delete(SESSION_PREFIX + code);
  try {
    window.localStorage.removeItem(SESSION_PREFIX + code);
  } catch {
    /* ignoré */
  }
}

export function loadIdentity(): Identity | null {
  if (typeof window === 'undefined') return null;
  const raw = safeGet(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Identity;
    return parsed.name ? parsed : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity) {
  if (typeof window === 'undefined') return;
  safeSet(IDENTITY_KEY, JSON.stringify(identity));
}
