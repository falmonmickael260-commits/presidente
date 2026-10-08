import { DEFAULT_SETTINGS } from '@/game/engine';
import type { GameState } from '@/game/types';

/**
 * Persistance optionnelle sur Supabase (PostgREST).
 *
 * Le serveur Next.js reste la **source de vérité** : Supabase ne sert qu'à faire
 * survivre les salles à un redémarrage. La diffusion temps réel passe par SSE et
 * non par Supabase Realtime, car chaque joueur doit recevoir une vue *différente*
 * (sa main uniquement) — une diffusion de lignes brutes exposerait les mains
 * adverses à tous les abonnés du canal.
 *
 * Aucune configuration n'est requise : sans variables d'environnement, tout est
 * neutralisé et le jeu fonctionne en mémoire.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const persistenceEnabled = Boolean(url && key);

interface RoomRow {
  code: string;
  state: GameState;
  tokens: Record<string, string>;
  updated_at: string;
}

function headers(): HeadersInit {
  return {
    apikey: key as string,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
}

export async function saveRoom(
  code: string,
  state: GameState,
  tokens: Record<string, string>,
): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    await fetch(`${url}/rest/v1/rooms?on_conflict=code`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify([
        { code, state, tokens, updated_at: new Date().toISOString() },
      ]),
      cache: 'no-store',
    });
  } catch {
    // La persistance est un confort : une panne réseau ne doit jamais interrompre une partie.
  }
}

/**
 * Une salle écrite par une version antérieure peut manquer des champs ajoutés
 * depuis. On réapplique les valeurs par défaut plutôt que de laisser un `undefined`
 * désactiver silencieusement une règle.
 */
function hydrate(state: GameState): GameState {
  return {
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...state.settings },
    skipThreat: state.skipThreat ?? false,
  };
}

export async function loadRoom(
  code: string,
): Promise<{ state: GameState; tokens: Record<string, string> } | null> {
  if (!persistenceEnabled) return null;
  try {
    const response = await fetch(
      `${url}/rest/v1/rooms?code=eq.${encodeURIComponent(code)}&select=code,state,tokens&limit=1`,
      { headers: headers(), cache: 'no-store' },
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as RoomRow[];
    const row = rows[0];
    if (!row) return null;
    return { state: hydrate(row.state), tokens: row.tokens ?? {} };
  } catch {
    return null;
  }
}

export async function deleteRoom(code: string): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    await fetch(`${url}/rest/v1/rooms?code=eq.${encodeURIComponent(code)}`, {
      method: 'DELETE',
      headers: headers(),
      cache: 'no-store',
    });
  } catch {
    /* ignoré volontairement */
  }
}
