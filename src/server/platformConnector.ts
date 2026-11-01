import type { Adapter } from '../../platform-connector/server.mjs';
import { findRoom, joinRoom, commit } from '@/server/store';
import { MAX_PLAYERS } from '@/game/engine';

export const adapter: Adapter = {
  async inspect(c) {
    const room = await findRoom(c.room);
    const id = c.proof.token && room?.tokens.get(c.proof.token);
    const member = room?.state.players.find(p => p.id === id);
    const expected = c.inviter || c.uid;
    if (!room || !member || (member.platformUserId && expected && member.platformUserId !== expected)) throw new Error('Votre ami ne se trouve plus dans ce salon.');
    if (!member.platformUserId && expected) {
      if (room.state.players.some(p => p.id !== member.id && p.platformUserId === expected)) throw new Error('Ce compte possède déjà une place dans le salon.');
      member.platformUserId = expected; commit(room, []);
    }
    return { code: room.code, instance: `${room.code}:${room.state.createdAt}`, capacity: MAX_PLAYERS, count: room.state.players.length, status: room.state.phase === 'lobby' ? 'open' : 'started', ownerUid: member.platformUserId };
  },
  async admit(c) {
    const room = await findRoom(c.room);
    if (!room || `${room.code}:${room.state.createdAt}` !== c.instance) throw new Error('Salon introuvable.');
    const source = room.state.players.find(p => p.id === room.tokens.get(c.proof.token || ''));
    if (!source || (source.platformUserId && source.platformUserId !== c.inviter)) throw new Error('Votre ami a quitté le salon.');
    const existing = room.state.players.find(p => p.platformUserId === c.uid);
    if (existing) {
      const token = [...room.tokens].find(([, id]) => id === existing.id)?.[0];
      if (!token) throw new Error('Session expirée.');
      return { code: room.code, token, playerId: existing.id };
    }
    const joined = joinRoom(room, c.name.slice(0, 16), '🎮', c.uid);
    if (!joined.ok) throw new Error(joined.error);
    return { code: room.code, token: joined.token, playerId: joined.playerId };
  },
};
