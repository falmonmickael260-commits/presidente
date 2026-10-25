import type { Room } from './store';
import type { StandingEntry } from '@/game/types';

/**
 * Déclare le résultat d'une partie terminée au projet Supabase central de
 * Revanche Game (comptes, profils, statistiques). Optionnel : sans ces
 * variables d'environnement, Le Président fonctionne exactement comme avant,
 * en jeu autonome. Voir docs/PLATFORM.md (dépôt revanche-games-web) pour le
 * contrat complet.
 */

const url = process.env.PLATFORM_SUPABASE_URL;
const key = process.env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;

export const platformReportingEnabled = Boolean(url && key);

interface PlatformPlayer {
  user_id: string | null;
  guest_label: string | null;
  outcome: 'win' | 'loss' | 'draw';
  score: number | null;
  position: number | null;
}

async function recordGameResult(params: {
  gameSlug: string;
  idempotencyKey: string;
  roomCode: string;
  rawPayload: unknown;
  players: PlatformPlayer[];
}): Promise<void> {
  if (!platformReportingEnabled) return;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/record_game_result`, {
      method: 'POST',
      headers: {
        apikey: key as string,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_game_slug: params.gameSlug,
        p_idempotency_key: params.idempotencyKey,
        p_room_code: params.roomCode,
        p_raw_payload: params.rawPayload,
        p_players: params.players,
      }),
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[platform] record_game_result failed', response.status, body);
    }
  } catch (error) {
    // Une panne de la plateforme centrale ne doit jamais interrompre une partie en cours.
    console.error('[platform] record_game_result error', error);
  }
}

/**
 * Un seul rôle gagne réellement une manche de Président : la 1ʳᵉ place.
 * `position` est l'index dans `standings` (voir engine.ts, `ranking.map((p, index) => ...)`),
 * donc 0 = Président (gagnant), pas 1.
 */
function outcomeForPosition(position: number): 'win' | 'loss' {
  return position === 0 ? 'win' : 'loss';
}

export function reportMatchResult(room: Room, standings: StandingEntry[], finishedAt: number): void {
  if (!platformReportingEnabled) return;

  const players: PlatformPlayer[] = standings.map((entry) => {
    const player = room.state.players.find((p) => p.id === entry.playerId);
    const platformUserId = player?.platformUserId ?? null;
    return {
      user_id: platformUserId,
      guest_label: platformUserId ? null : (player?.name ?? 'Joueur'),
      outcome: outcomeForPosition(entry.position),
      score: entry.points,
      position: entry.position,
    };
  });

  void recordGameResult({
    gameSlug: 'president',
    idempotencyKey: `president:${room.code}:${finishedAt}`,
    roomCode: room.code,
    rawPayload: { standings },
    players,
  });
}
