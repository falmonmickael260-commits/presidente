'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '@/game/engine';
import type { PlayerView } from '@/game/view';
import type { RoomHandle } from '@/hooks/useRoom';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { RulesSheet } from '@/components/game/RulesSheet';
import { ShareRow } from './ShareRow';

interface LobbyProps {
  view: PlayerView;
  code: string;
  room: RoomHandle;
  onLeave: () => void;
}

export function Lobby({ view, code, room, onLeave }: LobbyProps) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = view.players.find((p) => p.id === view.youId);
  const isHost = Boolean(me?.isHost);
  const enough = view.players.length >= MIN_PLAYERS;
  const full = view.players.length >= MAX_PLAYERS;

  const act = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(true);
    await room.send(action, payload);
    setBusy(false);
  };

  return (
    <div className="felt-surface felt-grain relative min-h-dvh w-full overflow-y-auto">
      <div className="pt-safe pb-safe relative mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 py-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.3em] text-gold-500/70">
              Salon
            </p>
            <h1 className="font-display text-3xl leading-tight">Le Président</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={onLeave}>
            Quitter
          </Button>
        </header>

        <ShareRow code={code} />

        <section className="panel rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg">
              Joueurs{' '}
              <span className="text-cream/40">
                {view.players.length}/{MAX_PLAYERS}
              </span>
            </h2>
            {!enough && (
              <Chip tone="warn">Minimum {MIN_PLAYERS}</Chip>
            )}
          </div>

          <ul className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {view.players.map((player) => (
                <motion.li
                  key={player.id}
                  layout
                  initial={{ opacity: 0, x: -16, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 16, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-ink-950/60 text-xl no-select">
                    {player.avatar}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold">
                    {player.name}
                    {player.id === view.youId && (
                      <span className="ml-1.5 text-[0.7rem] font-normal text-gold-400/80">vous</span>
                    )}
                  </span>
                  {player.isHost && <Chip tone="gold">Hôte</Chip>}
                  {player.isBot && <Chip>Bot</Chip>}
                  {isHost && player.id !== view.youId && (
                    <button
                      onClick={() => act('kick', { targetId: player.id })}
                      disabled={busy}
                      aria-label={`Retirer ${player.name}`}
                      className="grid h-7 w-7 place-items-center rounded-lg text-cream/35 transition hover:bg-ruby-600/20 hover:text-ruby-400"
                    >
                      ✕
                    </button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>

            {Array.from({ length: Math.max(0, MIN_PLAYERS - view.players.length) }).map(
              (_, index) => (
                <li
                  key={`empty-${index}`}
                  className="flex items-center gap-3 rounded-2xl border border-dashed border-white/8 px-3 py-2.5 text-cream/25"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-white/10 text-sm">
                    ?
                  </span>
                  <span className="text-[0.88rem]">En attente d’un joueur…</span>
                </li>
              ),
            )}
          </ul>

          {isHost && !full && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              block
              disabled={busy}
              onClick={() => act('add_bot')}
            >
              + Ajouter un bot
            </Button>
          )}
        </section>

        {isHost && (
          <section className="panel rounded-3xl p-4">
            <h2 className="mb-3 text-lg">Réglages</h2>
            <div className="flex flex-col gap-3.5">
              <SettingRow
                label="Temps par tour"
                value={`${view.settings.turnSeconds} s`}
              >
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={view.settings.turnSeconds}
                  onChange={(event) =>
                    act('settings', { settings: { turnSeconds: Number(event.target.value) } })
                  }
                  className="w-full accent-[#ecd08a]"
                  aria-label="Temps par tour en secondes"
                />
              </SettingRow>

              <SettingRow label="Manches" value={String(view.settings.rounds)}>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={view.settings.rounds}
                  onChange={(event) =>
                    act('settings', { settings: { rounds: Number(event.target.value) } })
                  }
                  className="w-full accent-[#ecd08a]"
                  aria-label="Nombre de manches"
                />
              </SettingRow>

              <ToggleRow
                label="Autoriser la valeur égale"
                hint="Permet de reposer la même valeur, et donc de compléter un carré carte après carte (5 → 5 → 5 → 5)."
                checked={view.settings.allowEqualRank}
                onChange={(checked) =>
                  act('settings', { settings: { allowEqualRank: checked } })
                }
              />

              <ToggleRow
                label="Même valeur = le suivant saute"
                hint="Sur une carte seule, reposer la valeur de la table fait sauter le joueur suivant — sauf s’il repose lui aussi cette valeur : le saut glisse alors d’un cran. Les paires ne sont pas concernées."
                checked={view.settings.skipOnEqual}
                disabled={!view.settings.allowEqualRank}
                onChange={(checked) => act('settings', { settings: { skipOnEqual: checked } })}
              />
            </div>
          </section>
        )}

        {/* Barre d'action collée en bas : le bouton reste atteignable même
            quand la liste des joueurs dépasse l'écran. */}
        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 bg-[linear-gradient(to_top,rgba(4,20,15,0.96)_55%,transparent)] px-4 pb-2 pt-4">
          <Button variant="ghost" size="sm" onClick={() => setRulesOpen(true)}>
            Voir les règles
          </Button>
          {isHost ? (
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!enough || busy}
              onClick={() => act('start_game')}
            >
              {enough
                ? 'Lancer la partie'
                : `Encore ${MIN_PLAYERS - view.players.length} joueur${
                    MIN_PLAYERS - view.players.length > 1 ? 's' : ''
                  }`}
            </Button>
          ) : (
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3.5 text-center text-[0.86rem] text-cream/55">
              En attente du lancement par l’hôte…
            </div>
          )}
        </div>
      </div>

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 ${
        disabled ? 'opacity-45' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#ecd08a]"
      />
      <span className="flex-1">
        <span className="block text-[0.88rem] font-semibold">{label}</span>
        <span className="block text-[0.74rem] leading-snug text-cream/45">{hint}</span>
      </span>
    </label>
  );
}

function SettingRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[0.8rem] font-semibold text-cream/80">{label}</span>
        <span className="text-[0.8rem] font-bold tabular-nums text-gold-300">{value}</span>
      </div>
      {children}
    </div>
  );
}
