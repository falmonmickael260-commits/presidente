'use client';

import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
} from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { comboLabel } from '@/game/cards';
import { DEAL_MS } from '@/game/engine';
import type { TableTop } from '@/game/rules';
import { useDirector } from '@/hooks/useDirector';
import { useHandSelection } from '@/hooks/useHandSelection';
import type { RoomHandle } from '@/hooks/useRoom';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/haptics';
import { ActionBar } from './ActionBar';
import { anchorKeys, useAnchors } from './Anchors';
import { CarreOverlay } from './CarreOverlay';
import { CenterPile } from './CenterPile';
import { ExchangePanel } from './ExchangePanel';
import { FlightLayer } from './FlightLayer';
import { HandFan } from './HandFan';
import { MySeatBadge } from './MySeatBadge';
import { Notices } from './Notices';
import { PlayerSeat } from './PlayerSeat';
import { RoundResults } from './RoundResults';
import { RulesSheet } from './RulesSheet';
import { TopBar } from './TopBar';
import { buildStatusText } from './status';
import {
  ARENA_CENTER_Y,
  PHASE_LABELS,
  pileCardWidth as computePileCardWidth,
  seatPosition,
  stripPileTopPercent,
} from './tableLayout';

export function GameTable({
  room,
  code,
  onLeave,
}: {
  room: RoomHandle;
  code: string;
  onLeave: () => void;
}) {
  const view = room.view;
  const { read } = useAnchors();
  const reducedMotion = useReducedMotion() ?? false;

  const tableRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [dealOrigin, setDealOrigin] = useState({ dx: 0, dy: -200 });
  const [dealProgress, setDealProgress] = useState(1);
  const focusControls = useAnimationControls();

  useEffect(() => setSoundOn(sound().isEnabled()), []);

  // Mesure avant peinture : la main n'est montée qu'une fois la table mesurée,
  // pour que les cartes partent tout de suite du bon endroit à la distribution.
  useLayoutEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
      const deck = read(anchorKeys.deck);
      const hand = read(anchorKeys.hand);
      setDealOrigin(
        deck && hand
          ? { dx: deck.x - hand.x, dy: deck.y - hand.y }
          : { dx: 0, dy: -Math.max(180, element.clientHeight * 0.55) },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [read]);

  const compact = size.width > 0 && size.width < 640;
  const cardWidth = useMemo(() => computePileCardWidth(size, compact), [size, compact]);

  const director = useDirector({
    view,
    events: room.events,
    consumeEvents: room.consumeEvents,
    readAnchor: read,
    reducedMotion,
    pileCardWidth: cardWidth,
    handCardWidth: cardWidth,
    authoritativePile: room.status === 'polling',
  });

  useEffect(() => {
    const deck = read(anchorKeys.deck);
    const hand = read(anchorKeys.hand);
    if (deck && hand) setDealOrigin({ dx: deck.x - hand.x, dy: deck.y - hand.y });
  }, [read, director.dealToken]);

  // Micro-zoom sur le centre à chaque pose : le regard suit la carte.
  useEffect(() => {
    if (reducedMotion || director.focusToken === 0) return;
    void focusControls.start({
      scale: [1, 1.035, 1],
      transition: { duration: 0.5, times: [0, 0.3, 1], ease: 'easeOut' },
    });
  }, [director.focusToken, focusControls, reducedMotion]);

  // Pendant la distribution, les compteurs montent au rythme des cartes.
  useEffect(() => {
    if (view?.phase !== 'dealing' || view.phaseEndsAt === null) {
      setDealProgress(1);
      return;
    }
    const end = view.phaseEndsAt;
    const tick = () =>
      setDealProgress(
        Math.max(0, Math.min(1, (Date.now() + room.clockSkew - (end - DEAL_MS)) / DEAL_MS)),
      );
    tick();
    const timer = setInterval(tick, 110);
    return () => clearInterval(timer);
  }, [view?.phase, view?.phaseEndsAt, room.clockSkew]);

  const me = view?.players.find((p) => p.id === view.youId) ?? null;
  const currentPlayer = view?.players.find((p) => p.id === view.currentPlayerId) ?? null;
  const isYourTurn = Boolean(view?.youId && view.currentPlayerId === view.youId);

  const pendingTransfer = useMemo(
    () =>
      view?.exchange?.transfers.find(
        (t) => t.fromId === view.youId && t.mode === 'choice' && !t.done,
      ) ?? null,
    [view],
  );
  const exchangeMode = view?.phase === 'exchange' && pendingTransfer !== null;

  const tableTop = useMemo<TableTop | null>(() => {
    if (!view || view.requiredCount === null || view.pile.length === 0) return null;
    return { rank: view.pile[view.pile.length - 1].rank, count: view.requiredCount };
  }, [view]);

  const mustPlayQueen = Boolean(
    view?.mustOpenWithQueenOfSpades && view.pile.length === 0 && isYourTurn,
  );

  // La valeur dominante vient d'être reposée : le joueur du tour ne peut que
  // la reposer à son tour — sinon il saute, sans pour autant quitter le pli.
  const skipThreat = Boolean(view?.skipThreat && view.phase === 'playing');

  const selection = useHandSelection({
    view,
    exchangeMode,
    pendingTransfer,
    tableTop,
    mustPlayQueen,
    skipThreat,
  });

  const playSelected = useCallback(async () => {
    if (selection.selected.length === 0) return;
    // Position réelle de chaque carte au moment du lancer : la carte part
    // exactement d'où le joueur la voit.
    for (const id of selection.selected) {
      const anchor = read(anchorKeys.card(id));
      if (anchor) director.noteLaunch(id, anchor);
    }
    const ids = [...selection.selected];
    selection.clear();
    haptic('impact');
    const ok = await room.send(exchangeMode ? 'exchange_give' : 'play', { cardIds: ids });
    if (!ok) {
      sound().play('error');
      selection.setSelected(ids);
    }
  }, [selection, read, director, room, exchangeMode]);

  // Repli : « passer » quitte le pli, « sauter » laisse juste filer le tour.
  const foldTurn = useCallback(async () => {
    selection.clear();
    const ok = await room.send(skipThreat ? 'skip' : 'pass');
    if (!ok) sound().play('error');
  }, [room, selection, skipThreat]);

  const toggleSound = useCallback(() => {
    const next = !sound().isEnabled();
    sound().setEnabled(next);
    setSoundOn(next);
    if (next) sound().play('select');
  }, []);

  const canPlay =
    selection.check.valid && (exchangeMode || (isYourTurn && view?.phase === 'playing'));
  // Sauter comme passer n'ont de sens qu'avec une combinaison sur la table.
  const canFold = isYourTurn && view?.phase === 'playing' && view.pile.length > 0;

  /* Raccourcis clavier : le jeu reste jouable sans souris. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Enter' && canPlay) {
        event.preventDefault();
        void playSelected();
      } else if ((event.key === 'p' || event.key === 'P') && canFold) {
        event.preventDefault();
        void foldTurn();
      } else if (event.key === 'Escape') {
        selection.clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPlay, canFold, playSelected, foldTurn, selection]);

  if (!view) return null;

  const opponents = (() => {
    const ordered = view.players.slice().sort((a, b) => a.seat - b.seat);
    const myIndex = view.youId ? ordered.findIndex((p) => p.id === view.youId) : -1;
    if (myIndex === -1) return ordered;
    return [...ordered.slice(myIndex + 1), ...ordered.slice(0, myIndex)];
  })();

  // Au-delà de 5 joueurs sur écran étroit, l'ellipse ne tient plus.
  const ringLayout = !compact || view.players.length <= 5;
  const pileTop = ringLayout
    ? ARENA_CENTER_Y * 100
    : stripPileTopPercent(size, opponents.length);

  const statusText = buildStatusText({
    view,
    me,
    currentPlayer,
    isYourTurn,
    mustPlayQueen,
    tableTop,
    pendingTransfer,
  });

  const seatFor = (playerId: string) => ({
    isCurrent: view.currentPlayerId === playerId,
    hasLead: view.lastPlayerId === playerId,
    deadline: view.currentPlayerId === playerId ? view.turnDeadline : null,
    totalMs: view.turnTotalMs ?? view.settings.turnSeconds * 1000,
  });

  const dealingCount = (count: number) =>
    view.phase === 'dealing' ? Math.round(count * dealProgress) : undefined;

  return (
    <div className="felt-surface felt-grain relative flex h-dvh w-full flex-col overflow-hidden">
      <TopBar
        code={code}
        roundNumber={view.roundNumber}
        rounds={view.settings.rounds}
        phaseLabel={PHASE_LABELS[view.phase]}
        status={room.status}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        onOpenRules={() => setRulesOpen(true)}
        onLeave={onLeave}
      />

      {/* ------------------------------ Table ------------------------------ */}
      <div ref={tableRef} className="relative min-h-0 flex-1">
        {/* Décor volontairement débordant, rogné ici même : sans ce calque,
            son débordement rendait la table défilable, et donner le focus à
            une carte du bord faisait glisser toute l'interface de 33 px. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Ovale de jeu : profondeur et lumière rasante. */}
          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
            style={{
              top: `${ARENA_CENTER_Y * 100}%`,
              width: '104%',
              height: '86%',
              background:
                'radial-gradient(ellipse at 50% 36%, rgba(255,255,255,0.07), rgba(255,255,255,0.018) 48%, transparent 72%)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -40px 80px rgba(0,0,0,0.4), 0 50px 130px -50px rgba(0,0,0,0.95)',
            }}
          />
          {/* Bord proche : le tapis se prolonge vers le joueur. */}
          <div
            className="pointer-events-none absolute inset-x-[-8%] bottom-[-26%] h-[52%] rounded-[50%]"
            style={{
              background:
                'radial-gradient(ellipse at 50% 0%, rgba(17,96,69,0.5), rgba(10,58,42,0.22) 46%, transparent 72%)',
            }}
          />
          {/* Halo sur la zone d'accueil du pli. */}
          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
            style={{
              top: `${pileTop}%`,
              width: '62%',
              height: '46%',
              background:
                'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.07), transparent 70%)',
            }}
          />
        </div>

        {ringLayout ? (
          opponents.map((player, index) => {
            const position = seatPosition(
              index,
              view.players.length,
              size,
              compact ? 52 : 66,
              compact ? 66 : 78,
            );
            return (
              <div
                key={player.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: position.left, top: position.top }}
              >
                <PlayerSeat
                  player={player}
                  isYou={false}
                  skew={room.clockSkew}
                  compact={compact}
                  cardCountOverride={dealingCount(player.cardCount)}
                  {...seatFor(player.id)}
                />
              </div>
            );
          })
        ) : (
          /* Table nombreuse sur écran étroit : un bandeau évite tout chevauchement. */
          <div className="absolute inset-x-0 top-0 flex flex-wrap justify-center gap-x-1 gap-y-1.5 px-1.5 pt-1">
            {opponents.map((player) => (
              <PlayerSeat
                key={player.id}
                player={player}
                isYou={false}
                skew={room.clockSkew}
                compact
                dense
                cardCountOverride={dealingCount(player.cardCount)}
                {...seatFor(player.id)}
              />
            ))}
          </div>
        )}

        <motion.div
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 will-animate"
          style={{ top: `${pileTop}%` }}
          animate={focusControls}
        >
          <CenterPile
            sets={director.tableSets}
            cardWidth={cardWidth}
            sweepWinnerId={director.sweepWinnerId}
            reducedMotion={reducedMotion}
          />
          <AnimatePresence>
            {view.phase === 'exchange' && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <ExchangePanel view={view} />
              </div>
            )}
          </AnimatePresence>
        </motion.div>

        <AnimatePresence>
          {view.phase === 'playing' && tableTop && (
            <motion.div
              key={`${tableTop.rank}-${tableTop.count}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-ink-950/55 px-3 py-1 backdrop-blur-sm"
              style={{ top: `calc(${pileTop}% + ${cardWidth * 1.05}px)` }}
            >
              <span className="text-[0.66rem] uppercase tracking-[0.14em] text-cream/55">
                À battre · {comboLabel(tableTop.rank, tableTop.count)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* L'avis de connexion vit dans le flux : posé par-dessus, il masquerait
          la main au moment précis où le joueur en a le plus besoin. */}
      {(room.status === 'reconnecting' || room.status === 'polling') && (
        <div className="relative z-20 flex shrink-0 justify-center px-3 pt-1">
          <span
            role="status"
            className="rounded-full border border-amber-300/30 bg-ink-950/80 px-3.5 py-1 text-[0.7rem] font-semibold text-amber-200 backdrop-blur"
          >
            {room.status === 'polling'
              ? 'Mode secours — vous pouvez continuer à jouer'
              : 'Reconnexion en cours…'}
          </span>
        </div>
      )}

      {/* --------------------------- Barre d'action -------------------------- */}
      <div className="relative z-20 shrink-0 py-1.5">
        <ActionBar
          isYourTurn={isYourTurn || exchangeMode}
          statusText={statusText}
          selectionText={selection.check.text}
          selectionValid={selection.check.valid}
          primaryLabel={exchangeMode ? 'Donner' : 'Jouer'}
          canPlay={canPlay}
          onPlay={playSelected}
          secondaryLabel={skipThreat ? 'Sauter' : 'Passer'}
          canSecondary={canFold}
          onSecondary={foldTurn}
          onClear={selection.clear}
          hasSelection={selection.selected.length > 0}
          showSecondary={!exchangeMode}
          badge={<MySeatBadge view={view} skew={room.clockSkew} isYourTurn={isYourTurn} />}
        />
      </div>

      {/* ------------------------------- Main ------------------------------- */}
      <div className="pb-safe relative z-10 shrink-0 px-1">
        {size.width > 0 && (
          <HandFan
            key={`hand-${view.roundNumber}`}
            cards={view.hand}
            selectedIds={selection.selected}
            playableIds={exchangeMode ? view.hand.map((c) => c.id) : view.playableCardIds}
            onToggle={selection.toggle}
            width={Math.min(size.width, 1080)}
            compact={compact}
            interactive={(view.phase === 'playing' && isYourTurn) || exchangeMode}
            dealStagger={
              view.phase === 'dealing' ? (DEAL_MS / 1000 / 52) * view.players.length : 0
            }
            dealOrigin={dealOrigin}
            reducedMotion={reducedMotion}
          />
        )}
      </div>

      <FlightLayer
        flights={director.flights}
        onLanded={director.onLanded}
        reducedMotion={reducedMotion}
      />
      <Notices notices={director.notices} />
      <CarreOverlay
        moment={director.carre}
        playerName={
          view.players.find((p) => p.id === director.carre?.playerId)?.name ?? 'Un joueur'
        }
        reducedMotion={reducedMotion}
      />
      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {(view.phase === 'round_end' || view.phase === 'game_over') && (
        <RoundResults
          view={view}
          isHost={Boolean(me?.isHost)}
          onNextRound={() => void room.send('next_round')}
          onRestart={() => void room.send('restart')}
          skew={room.clockSkew}
          reducedMotion={reducedMotion}
        />
      )}

    </div>
  );
}
