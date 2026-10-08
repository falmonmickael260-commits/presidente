'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCardId, rankName } from '@/game/cards';
import type { Card, PlayedSet, Rank, StampedEvent } from '@/game/types';
import type { PlayerView } from '@/game/view';
import { haptic } from '@/lib/haptics';
import { sound } from '@/lib/sound';
import { anchorKeys, type Anchor } from '@/components/game/Anchors';
import type { Flight } from '@/components/game/FlightLayer';
import { combinedOffset } from '@/components/game/pileLayout';

export interface CarreMoment {
  playerId: string;
  rank: Rank;
  token: number;
}

export interface Notice {
  id: number;
  text: string;
  tone: 'neutral' | 'good' | 'warn';
}

interface DirectorOptions {
  view: PlayerView | null;
  events: StampedEvent[];
  consumeEvents: (upToSeq: number) => void;
  readAnchor: (key: string) => Anchor | null;
  reducedMotion: boolean;
  pileCardWidth: number;
  handCardWidth: number;
}

export interface Director {
  flights: Flight[];
  onLanded: (id: string) => void;
  /** Poses effectivement arrivées sur la table (et non ce que dit le serveur).
   *  Le serveur ferme un pli dès le carré posé : c'est le client qui décide
   *  quand les cartes quittent la table, une fois le moment joué. */
  tableSets: PlayedSet[];
  /** Renseigné pendant le balayage du pli vers le gagnant. */
  sweepWinnerId: string | null;
  carre: CarreMoment | null;
  notices: Notice[];
  /** Incrémenté à chaque distribution : déclenche l'entrée animée de la main. */
  dealToken: number;
  /** Incrémenté à chaque pose : déclenche le micro-zoom sur le centre de la table. */
  focusToken: number;
  lastTrickWinnerId: string | null;
  noteLaunch: (cardId: string, anchor: Anchor) => void;
}

const FLIGHT_DURATION = 0.62;
const QUAD_DURATION = 0.72;

let noticeId = 0;

export function useDirector({
  view,
  events,
  consumeEvents,
  readAnchor,
  reducedMotion,
  pileCardWidth,
  handCardWidth,
}: DirectorOptions): Director {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [tableSets, setTableSets] = useState<PlayedSet[]>([]);
  const [sweepWinnerId, setSweepWinnerId] = useState<string | null>(null);
  const [carre, setCarre] = useState<CarreMoment | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dealToken, setDealToken] = useState(0);
  const [focusToken, setFocusToken] = useState(0);
  const [lastTrickWinnerId, setLastTrickWinnerId] = useState<string | null>(null);

  const launchRects = useRef(new Map<string, Anchor>());
  const pendingBySet = useRef(new Map<string, number>());
  const pendingSetData = useRef(new Map<string, PlayedSet>());
  const tableSetsRef = useRef<PlayedSet[]>([]);
  const sweepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flightSet = useRef(new Map<string, string>());
  const handledSeq = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  tableSetsRef.current = tableSets;

  const noteLaunch = useCallback((cardId: string, anchor: Anchor) => {
    launchRects.current.set(cardId, anchor);
  }, []);

  const pushNotice = useCallback((text: string, tone: Notice['tone'] = 'neutral') => {
    const notice: Notice = { id: ++noticeId, text, tone };
    setNotices((current) => [...current.slice(-3), notice]);
    setTimeout(() => {
      setNotices((current) => current.filter((n) => n.id !== notice.id));
    }, 3400);
  }, []);

  /** Intègre une pose au pli visible, en conservant l'ordre d'arrivée. */
  const settleSet = useCallback((setId: string) => {
    const data = pendingSetData.current.get(setId);
    pendingSetData.current.delete(setId);
    if (!data) return;
    setTableSets((current) =>
      current.some((set) => set.id === setId)
        ? current
        : [...current, { ...data, order: current.length }],
    );
  }, []);

  const clearTable = useCallback(() => {
    for (const timer of sweepTimers.current) clearTimeout(timer);
    sweepTimers.current = [];
    setTableSets([]);
    setSweepWinnerId(null);
  }, []);

  const dropFlights = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const doomed = new Set(ids);
    for (const id of ids) flightSet.current.delete(id);
    setFlights((current) => current.filter((f) => !doomed.has(f.id)));
  }, []);

  const finishSet = useCallback(
    (setId: string) => {
      if (!pendingBySet.current.has(setId)) return;
      pendingBySet.current.delete(setId);
      settleSet(setId);
      const siblings = Array.from(flightSet.current.entries())
        .filter(([, owner]) => owner === setId)
        .map(([id]) => id);
      // On retire les cartes en vol une frame après leur intégration au pli :
      // la carte posée est déjà rendue, il n'y a donc aucun clignotement.
      requestAnimationFrame(() => dropFlights(siblings));
    },
    [dropFlights, settleSet],
  );

  const onLanded = useCallback(
    (flightId: string) => {
      const setId = flightSet.current.get(flightId);
      if (!setId || setId.startsWith('deal:') || setId.startsWith('swap:')) {
        dropFlights([flightId]);
        return;
      }
      const remaining = (pendingBySet.current.get(setId) ?? 1) - 1;
      pendingBySet.current.set(setId, remaining);
      if (remaining > 0) return;
      finishSet(setId);
    },
    [dropFlights, finishSet],
  );

  /* -------------------------------------------------------------- */
  /* Traduction des événements serveur en mouvements                 */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    if (events.length === 0) return;
    const fresh = events.filter((e) => e.seq > handledSeq.current);
    if (fresh.length === 0) return;
    handledSeq.current = fresh[fresh.length - 1].seq;
    const consumeTo = handledSeq.current;

    // Les poses sont enregistrées comme « en vol » tout de suite, avant même
    // d'être animées : sans cela, la synchronisation de rattrapage les
    // considérerait comme déjà posées et la carte s'afficherait en double.
    if (!reducedMotion) {
      for (const { event } of fresh) {
        if (event.type === 'play') {
          pendingBySet.current.set(event.setId, event.cards.length);
        }
      }
    }

    // On attend une frame avant de lire les positions : au montage de la table,
    // la mise en page n'est pas encore stabilisée et les sièges seraient lus
    // au mauvais endroit — les cartes partiraient alors de nulle part.
    requestAnimationFrame(() => {
      const current = viewRef.current;
      const created: Flight[] = [];
      let carreInBatch = false;
      let playInBatch = false;

      for (const { seq, event } of fresh) {
        switch (event.type) {
          case 'deal': {
            setDealToken((token) => token + 1);
            clearTable();
            pendingSetData.current.clear();
            const deck = readAnchor(anchorKeys.deck);
            if (!deck || reducedMotion || !current) break;

            let index = 0;
            const total = Object.values(event.perPlayer).reduce((a, b) => a + b, 0);
            const step = Math.min(0.055, 2.2 / Math.max(total, 1));
            const maxCards = Math.max(...Object.values(event.perPlayer));

            for (let round = 0; round < maxCards; round++) {
              for (const player of current.players) {
                if ((event.perPlayer[player.id] ?? 0) <= round) continue;
                index++;
                if (player.id === current.youId) continue;
                const seat = readAnchor(anchorKeys.seat(player.id));
                if (!seat) continue;
                const id = `deal:${seq}:${player.id}:${round}`;
                flightSet.current.set(id, `deal:${seq}`);
                created.push({
                  id,
                  card: null,
                  fromX: deck.x,
                  fromY: deck.y,
                  fromWidth: pileCardWidth * 0.52,
                  toX: seat.x,
                  toY: seat.y,
                  toWidth: pileCardWidth * 0.44,
                  rotateFrom: 0,
                  rotateTo: (Math.random() - 0.5) * 40,
                  delay: index * step,
                  duration: 0.42,
                  arc: 40,
                  bounce: false,
                });
                if (index % 3 === 0) sound().play('deal', { delay: index * step });
              }
            }
            break;
          }

          case 'play': {
            playInBatch = true;
            setFocusToken((token) => token + 1);
            pendingSetData.current.set(event.setId, {
              id: event.setId,
              playerId: event.playerId,
              cards: event.cards,
              rank: event.cards[0].rank,
              order: 0,
            });
            const pile = readAnchor(anchorKeys.pile);
            if (!pile) {
              pendingBySet.current.delete(event.setId);
              settleSet(event.setId);
              break;
            }
            const order = current?.pile.length ?? 0;
            const isQuad = event.cards.length === 4;
            const duration = isQuad ? QUAD_DURATION : FLIGHT_DURATION;

            if (reducedMotion) {
              pendingBySet.current.delete(event.setId);
              settleSet(event.setId);
              sound().play('land');
              break;
            }

            event.cards.forEach((card: Card, cardIndex: number) => {
              const source =
                launchRects.current.get(card.id) ??
                readAnchor(anchorKeys.seat(event.playerId)) ??
                readAnchor(anchorKeys.hand) ??
                pile;
              launchRects.current.delete(card.id);

              const offset = combinedOffset(
                event.setId,
                order,
                cardIndex,
                event.cards.length,
                pileCardWidth,
              );
              const delay = cardIndex * (isQuad ? 0.045 : 0.07);
              const id = `play:${seq}:${card.id}`;
              flightSet.current.set(id, event.setId);

              const travel = Math.hypot(pile.x - source.x, pile.y - source.y);
              created.push({
                id,
                card,
                fromX: source.x,
                fromY: source.y,
                fromWidth: source.width || handCardWidth,
                toX: pile.x + offset.dx,
                toY: pile.y + offset.dy,
                toWidth: pileCardWidth,
                rotateFrom: (Math.random() - 0.5) * 26,
                rotateTo: offset.rotate,
                delay,
                duration,
                arc: Math.min(170, 56 + travel * 0.19) * (isQuad ? 1.25 : 1),
                bounce: true,
              });

              sound().play('flick', { delay });
              sound().play('land', { delay: delay + duration * 0.86 });
            });

            // Filet de sécurité : si l'onglet passe en arrière-plan, les animations
            // ne se terminent pas. On intègre alors la pose au pli malgré tout.
            const guardDelay =
              (duration + event.cards.length * (isQuad ? 0.045 : 0.07) + 0.9) * 1000;
            const guardedSetId = event.setId;
            setTimeout(() => finishSet(guardedSetId), guardDelay);

            if (event.isQueenOpening) {
              pushNotice('Dame de pique — la partie commence', 'good');
            }
            break;
          }

          case 'exchange_transfer': {
            const involved =
              current?.youId === event.fromId || current?.youId === event.toId;
            if (involved) {
              const other = current?.players.find(
                (p) => p.id === (current.youId === event.fromId ? event.toId : event.fromId),
              );
              pushNotice(
                current?.youId === event.toId
                  ? `Vous recevez ${event.count} carte${event.count > 1 ? 's' : ''} de ${other?.name ?? 'votre adversaire'}`
                  : `Vous donnez ${event.count} carte${event.count > 1 ? 's' : ''} à ${other?.name ?? 'votre adversaire'}`,
                'good',
              );
            }

            const from = readAnchor(anchorKeys.seat(event.fromId));
            const to = readAnchor(anchorKeys.seat(event.toId));
            if (!from || !to || reducedMotion) break;

            // Les cartes ne sont montrées face visible qu'au donneur et au receveur.
            const faces = (event.cardIds ?? [])
              .map((id) => parseCardId(id))
              .filter((c): c is Card => c !== null);

            for (let i = 0; i < event.count; i++) {
              const id = `swap:${seq}:${i}`;
              flightSet.current.set(id, `swap:${seq}`);
              const face = faces[i] ?? null;
              const width = face ? pileCardWidth * 0.86 : pileCardWidth * 0.6;
              created.push({
                id,
                card: face,
                fromX: from.x,
                fromY: from.y,
                fromWidth: width,
                toX: to.x,
                toY: to.y,
                toWidth: width,
                rotateFrom: -20,
                rotateTo: 20,
                delay: i * 0.16,
                duration: 0.78,
                arc: 130,
                bounce: false,
              });
              sound().play('flick', { delay: i * 0.16 });
            }
            break;
          }

          case 'carre':
            carreInBatch = true;
            setCarre({ playerId: event.playerId, rank: event.rank, token: seq });
            sound().play('carre');
            haptic('success');
            break;

          case 'trick_won': {
            setLastTrickWinnerId(event.playerId);
            const winner = event.playerId;
            // Un carré mérite d'être vu : on laisse les quatre cartes sur la
            // table le temps du moment, puis le pli part vers son gagnant.
            // Si la pose qui ferme le pli est dans le même lot, on attend que
            // la carte soit arrivée et bien visible avant de balayer la table.
            const hold = reducedMotion ? 120 : carreInBatch ? 2400 : playInBatch ? 1400 : 850;
            const startSweep = setTimeout(() => setSweepWinnerId(winner), hold);
            const finish = setTimeout(
              () => {
                pendingSetData.current.clear();
                setTableSets([]);
                setSweepWinnerId(null);
              },
              hold + (reducedMotion ? 60 : 660),
            );
            sweepTimers.current.push(startSweep, finish);
            break;
          }

          case 'pass':
            sound().play('pass');
            break;

          case 'skipped': {
            if (event.playerId === current?.youId) {
              pushNotice(`Tour sauté — pas de ${rankName(event.rank)} à reposer`, 'warn');
            } else {
              const name =
                current?.players.find((p) => p.id === event.playerId)?.name ?? 'Un joueur';
              pushNotice(`${name} saute son tour`, 'neutral');
            }
            sound().play('pass');
            break;
          }

          case 'timeout':
            if (event.playerId === current?.youId) {
              pushNotice('Temps écoulé — coup joué automatiquement', 'warn');
            }
            break;

          case 'player_finished': {
            const name =
              current?.players.find((p) => p.id === event.playerId)?.name ?? 'Un joueur';
            pushNotice(
              event.position === 0 ? `${name} est Président 👑` : `${name} a terminé`,
              event.position === 0 ? 'good' : 'neutral',
            );
            sound().play('finish');
            break;
          }

          case 'turn':
            if (event.playerId === current?.youId) sound().play('turn');
            break;

          case 'round_end':
            sound().play('victory');
            break;

          default:
            break;
        }
      }

      if (created.length > 0) setFlights((currentFlights) => [...currentFlights, ...created]);
      consumeEvents(consumeTo);
    });
  }, [
    events,
    consumeEvents,
    readAnchor,
    reducedMotion,
    pileCardWidth,
    handCardWidth,
    pushNotice,
    settleSet,
    finishSet,
  ]);

  /* -------------------------------------------------------------- */
  /* Synchronisation de rattrapage                                   */
  /* -------------------------------------------------------------- */

  // Après une reconnexion, les poses déjà sur la table n'ont jamais été animées :
  // on les considère posées d'office pour éviter un pli vide.
  useEffect(() => {
    if (!view) return;
    const known = new Set(tableSetsRef.current.map((set) => set.id));
    const missing = view.pile.filter(
      (set) => !known.has(set.id) && !pendingBySet.current.has(set.id),
    );
    if (missing.length === 0) return;
    setTableSets((current) => [
      ...current,
      ...missing.map((set, index) => ({ ...set, order: current.length + index })),
    ]);
  }, [view]);

  // Le serveur peut vider le pli sans qu'aucun événement de fermeture n'ait été
  // reçu (reconnexion en cours de pli) : on nettoie alors la table.
  useEffect(() => {
    if (!view) return;
    if (view.pile.length === 0 && view.phase !== 'playing' && tableSetsRef.current.length > 0) {
      clearTable();
    }
  }, [view, clearTable]);

  useEffect(() => () => clearTable(), [clearTable]);

  return {
    flights,
    onLanded,
    tableSets,
    sweepWinnerId,
    carre,
    notices,
    dealToken,
    focusToken,
    lastTrickWinnerId,
    noteLaunch,
  };
}
