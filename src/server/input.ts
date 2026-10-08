/** Validation défensive des entrées client : rien n'est supposé de confiance. */

import { AVATARS } from '@/lib/avatars';

const NAME_MAX = 16;
const ALLOWED_AVATARS: readonly string[] = AVATARS;

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return cleaned.length >= 2 ? cleaned : null;
}

export function sanitizeAvatar(raw: unknown): string {
  if (typeof raw === 'string' && ALLOWED_AVATARS.includes(raw)) return raw;
  return ALLOWED_AVATARS[Math.floor(Math.random() * ALLOWED_AVATARS.length)];
}

export function sanitizeCardIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > 4) return null;
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !/^(?:[3-9]|1[0-5])[SHDC]$/.test(item)) return null;
    ids.push(item);
  }
  return Array.from(new Set(ids)).length === ids.length ? ids : null;
}

export function sanitizeSettings(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return {};
  const value = raw as Record<string, unknown>;
  const out: {
    turnSeconds?: number;
    rounds?: number;
    allowEqualRank?: boolean;
    skipOnEqual?: boolean;
  } = {};
  if (typeof value.turnSeconds === 'number' && Number.isFinite(value.turnSeconds)) {
    out.turnSeconds = value.turnSeconds;
  }
  if (typeof value.rounds === 'number' && Number.isFinite(value.rounds)) {
    out.rounds = value.rounds;
  }
  if (typeof value.allowEqualRank === 'boolean') out.allowEqualRank = value.allowEqualRank;
  if (typeof value.skipOnEqual === 'boolean') out.skipOnEqual = value.skipOnEqual;
  return out;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
