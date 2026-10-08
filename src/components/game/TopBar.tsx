'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { ConnectionStatus } from '@/hooks/useRoom';

interface TopBarProps {
  code: string;
  roundNumber: number;
  rounds: number;
  phaseLabel: string;
  status: ConnectionStatus;
  soundOn: boolean;
  onToggleSound: () => void;
  onOpenRules: () => void;
  onLeave: () => void;
}

const STATUS_META: Record<ConnectionStatus, { label: string; color: string }> = {
  connecting: { label: 'Connexion…', color: 'bg-amber-300' },
  live: { label: 'En direct', color: 'bg-emerald-400' },
  reconnecting: { label: 'Reconnexion…', color: 'bg-amber-400' },
  polling: { label: 'Mode secours', color: 'bg-amber-300' },
  gone: { label: 'Déconnecté', color: 'bg-ruby-500' },
};

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.92 }}
      className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/6 text-[0.95rem] text-cream/75 transition hover:bg-white/14 hover:text-cream"
    >
      {children}
    </motion.button>
  );
}

export function TopBar({
  code,
  roundNumber,
  rounds,
  phaseLabel,
  status,
  soundOn,
  onToggleSound,
  onOpenRules,
  onLeave,
}: TopBarProps) {
  const [copied, setCopied] = useState(false);
  const meta = STATUS_META[status];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* presse-papiers indisponible */
    }
  };

  return (
    <header className="pt-safe relative z-30 flex shrink-0 items-center gap-2 px-3 pb-1 sm:px-5">
      <button
        onClick={copy}
        className="group flex items-center gap-2 rounded-xl border border-gold-500/25 bg-ink-950/45 px-2.5 py-1.5 backdrop-blur-md transition hover:border-gold-500/50"
        title="Copier le code de la salle"
      >
        <span className="font-display text-lg leading-none tracking-[0.18em] text-gold-300">
          {code}
        </span>
        <span className="text-[0.62rem] uppercase tracking-[0.1em] text-cream/45 group-hover:text-cream/70">
          {copied ? 'copié' : 'copier'}
        </span>
      </button>

      <div className="hidden items-center gap-1.5 rounded-xl bg-white/5 px-2.5 py-1.5 sm:flex">
        <span className={`h-1.5 w-1.5 rounded-full ${meta.color}`} />
        <span className="text-[0.68rem] uppercase tracking-[0.1em] text-cream/55">
          {meta.label}
        </span>
      </div>

      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-[0.7rem] uppercase tracking-[0.18em] text-cream/45">
          {roundNumber > 0 ? `Manche ${roundNumber}/${rounds}` : phaseLabel}
          <span className="hidden sm:inline">
            {roundNumber > 0 ? ` · ${phaseLabel}` : ''}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <IconButton label={soundOn ? 'Couper le son' : 'Activer le son'} onClick={onToggleSound}>
          {soundOn ? '🔊' : '🔇'}
        </IconButton>
        <IconButton label="Règles du jeu" onClick={onOpenRules}>
          ?
        </IconButton>
        <IconButton label="Quitter la table" onClick={onLeave}>
          ⏻
        </IconButton>
      </div>
    </header>
  );
}
