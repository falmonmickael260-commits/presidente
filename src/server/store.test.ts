import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attach,
  createRoom,
  detach,
  joinRoom,
  touchPresence,
  type Room,
  type Subscriber,
} from './store';

/** Abonné muet : on ne teste ici que la présence, pas la diffusion. */
function fakeSubscriber(playerId: string | null): Subscriber {
  return { id: `sub-${Math.random()}`, playerId, send: () => {} };
}

function roomWithPlayers(count: number): { room: Room; ids: string[] } {
  const room = createRoom();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const outcome = joinRoom(room, `Joueur ${i}`, '🐺');
    if (!outcome.ok) throw new Error(outcome.error);
    ids.push(outcome.playerId);
  }
  return { room, ids };
}

const connected = (room: Room, playerId: string) =>
  room.state.players.find((p) => p.id === playerId)!.connected;

describe('présence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ne déclare pas absent un joueur dont le flux se coupe brièvement', () => {
    const { room, ids } = roomWithPlayers(3);
    const sub = fakeSubscriber(ids[0]);
    attach(room, sub);
    expect(connected(room, ids[0])).toBe(true);

    // Micro-coupure : le flux tombe, le client revient avant la fin du délai.
    detach(room, sub);
    vi.advanceTimersByTime(4000);
    expect(connected(room, ids[0])).toBe(true);

    attach(room, fakeSubscriber(ids[0]));
    vi.advanceTimersByTime(30000);
    expect(connected(room, ids[0])).toBe(true);
  });

  it('déclare absent un joueur qui ne revient pas', () => {
    const { room, ids } = roomWithPlayers(3);
    const sub = fakeSubscriber(ids[0]);
    attach(room, sub);

    detach(room, sub);
    vi.advanceTimersByTime(11000);
    expect(connected(room, ids[0])).toBe(false);
  });

  it('garde le joueur présent tant qu’un autre onglet reste ouvert', () => {
    const { room, ids } = roomWithPlayers(3);
    const first = fakeSubscriber(ids[0]);
    const second = fakeSubscriber(ids[0]);
    attach(room, first);
    attach(room, second);

    detach(room, first);
    vi.advanceTimersByTime(30000);
    expect(connected(room, ids[0])).toBe(true);
  });

  it('libère la place dans le salon quand le joueur ne revient pas', () => {
    const { room, ids } = roomWithPlayers(3);
    const sub = fakeSubscriber(ids[0]);
    attach(room, sub);

    detach(room, sub);
    vi.advanceTimersByTime(11000);
    expect(room.state.players).toHaveLength(3);

    // Puis seulement, la place est rendue.
    vi.advanceTimersByTime(13000);
    expect(room.state.players.map((p) => p.id)).not.toContain(ids[0]);
  });

  it('le mode secours vaut présence : jouer sans flux ne rend pas absent', () => {
    const { room, ids } = roomWithPlayers(3);
    const sub = fakeSubscriber(ids[0]);
    attach(room, sub);
    detach(room, sub);

    // Le client bascule sur les instantanés : il n'a plus d'abonné au flux,
    // mais il se manifeste régulièrement.
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(2500);
      touchPresence(room, ids[0]);
    }
    expect(connected(room, ids[0])).toBe(true);

    // Dès qu'il cesse de se manifester, le délai de grâce reprend son cours.
    vi.advanceTimersByTime(11000);
    expect(connected(room, ids[0])).toBe(false);
  });

  it('ne libère pas la place d’un joueur revenu entre-temps', () => {
    const { room, ids } = roomWithPlayers(3);
    const sub = fakeSubscriber(ids[0]);
    attach(room, sub);

    detach(room, sub);
    vi.advanceTimersByTime(11000);
    attach(room, fakeSubscriber(ids[0]));
    vi.advanceTimersByTime(30000);

    expect(room.state.players.map((p) => p.id)).toContain(ids[0]);
    expect(connected(room, ids[0])).toBe(true);
  });
});
