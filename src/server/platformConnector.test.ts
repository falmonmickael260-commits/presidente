import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { adapter } from './platformConnector';
import { createRoom, joinRoom } from './store';
import type { Command } from '../../platform-connector/server.mjs';
it('admet le compte invité une fois, conserve sa session et protège la dernière place', async () => {
  const room = createRoom(); const host = randomUUID(), guest = randomUUID();
  const a = joinRoom(room, 'Alice', '🐺', host); if (!a.ok) throw new Error(a.error);
  const c: Command = { v: 1, game: 'president', operation: 'admit', room: room.code, uid: guest, name: 'Bob', inviter: host,
    invitation: randomUUID(), instance: `${room.code}:${room.state.createdAt}`, proof: { code: room.code, token: a.token } };
  expect((await adapter.inspect(c)).count).toBe(1);
  const b = await adapter.admit(c);
  expect(await adapter.admit(c)).toEqual(b);
  expect(room.state.players.filter(p => p.platformUserId === guest)).toHaveLength(1);
  for (let i = 0; i < 5; i++) joinRoom(room, `Invité ${i}`, '🎲');
  const last = await Promise.allSettled([adapter.admit({ ...c, uid: randomUUID() }), adapter.admit({ ...c, uid: randomUUID() })]);
  expect(last.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect(room.state.players).toHaveLength(8);
  const anonymous = [...room.tokens].find(([, id]) => !room.state.players.find(p => p.id === id)?.platformUserId)!;
  await expect(adapter.inspect({ ...c, uid: guest, inviter: undefined, proof: { code: room.code, token: anonymous[0] } })).rejects.toThrow(/déjà une place/);
  await expect(adapter.inspect({ ...c, proof: { code: room.code, token: 'forged' } })).rejects.toThrow();
  await expect(adapter.admit({ ...c, instance: 'old-instance' })).rejects.toThrow();
});
