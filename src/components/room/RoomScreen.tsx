'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AnchorProvider } from '@/components/game/Anchors';
import { GameTable } from '@/components/game/GameTable';
import { IdentityPicker } from '@/components/lobby/IdentityPicker';
import { Lobby } from '@/components/lobby/Lobby';
import { Button } from '@/components/ui/Button';
import { useRoom } from '@/hooks/useRoom';
import { AVATARS, randomAvatar } from '@/lib/avatars';
import { clearSession, loadIdentity, loadSession, saveIdentity, saveSession } from '@/lib/session';
import { getIncomingPlatformToken, peekPlatformUsername } from '@/lib/platformToken';
import { sound } from '@/lib/sound';

type Probe =
  | { state: 'checking' }
  | { state: 'missing' }
  | { state: 'ready'; joinable: boolean; playerCount: number };

export function RoomScreen({ code }: { code: string }) {
  const [probe, setProbe] = useState<Probe>({ state: 'checking' });
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    setHasSession(Boolean(loadSession(code)));
  }, [code]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/rooms/${code}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) {
          setProbe({ state: 'missing' });
          return;
        }
        const body = (await response.json()) as { joinable: boolean; playerCount: number };
        setProbe({ state: 'ready', joinable: body.joinable, playerCount: body.playerCount });
      })
      .catch(() => alive && setProbe({ state: 'missing' }));
    return () => {
      alive = false;
    };
  }, [code, generation]);

  const onJoined = useCallback(() => {
    setHasSession(true);
    setGeneration((value) => value + 1);
  }, []);

  if (probe.state === 'checking' || hasSession === null) {
    return <Splash label="Ouverture de la table…" />;
  }

  if (probe.state === 'missing') {
    return (
      <Centered>
        <h1 className="font-display text-4xl">Salle introuvable</h1>
        <p className="max-w-sm text-[0.92rem] leading-relaxed text-cream/55">
          Le code <span className="font-semibold text-gold-300">{code}</span> ne correspond à
          aucune partie. Elle a peut-être expiré.
        </p>
        <Link href="/">
          <Button variant="primary" size="lg">
            Retour à l’accueil
          </Button>
        </Link>
      </Centered>
    );
  }

  if (!hasSession) {
    return <JoinGate code={code} joinable={probe.joinable} onJoined={onJoined} />;
  }

  return <ConnectedRoom key={`${code}:${generation}`} code={code} onRejoin={onJoined} />;
}

function ConnectedRoom({ code, onRejoin }: { code: string; onRejoin: () => void }) {
  const room = useRoom(code);
  const [kicked, setKicked] = useState(false);

  const leave = useCallback(async () => {
    // On prévient le serveur : dans le salon, la place est libérée aussitôt.
    await room.send('leave');
    room.leave();
    window.location.href = '/';
  }, [room]);

  // Le serveur ne nous reconnaît plus : jeton révoqué, salle relancée ou joueur retiré.
  useEffect(() => {
    if (room.view && room.view.youId === null) setKicked(true);
  }, [room.view]);

  if (kicked) {
    return (
      <Centered>
        <h1 className="font-display text-4xl">Vous n’êtes plus à cette table</h1>
        <p className="max-w-sm text-[0.92rem] text-cream/55">
          Votre place a été libérée. Vous pouvez rejoindre à nouveau si la partie n’a pas commencé.
        </p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              clearSession(code);
              setKicked(false);
              onRejoin();
              window.location.reload();
            }}
          >
            Rejoindre à nouveau
          </Button>
          <Link href="/">
            <Button variant="ghost">Accueil</Button>
          </Link>
        </div>
      </Centered>
    );
  }

  if (!room.view) return <Splash label="Synchronisation…" />;

  if (room.view.phase === 'lobby') {
    return <Lobby view={room.view} code={code} room={room} onLeave={() => void leave()} />;
  }

  return (
    <AnchorProvider>
      <GameTable room={room} code={code} onLeave={() => void leave()} />
    </AnchorProvider>
  );
}

function JoinGate({
  code,
  joinable,
  onJoined,
}: {
  code: string;
  joinable: boolean;
  onJoined: () => void;
}) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [platformUsername, setPlatformUsername] = useState<string | null>(null);

  useEffect(() => {
    setPlatformUsername(peekPlatformUsername(getIncomingPlatformToken()));
  }, []);

  useEffect(() => {
    const identity = loadIdentity();
    if (identity) {
      setName(identity.name);
      setAvatar(identity.avatar);
    } else {
      setAvatar(randomAvatar());
    }
  }, []);

  const join = async () => {
    setBusy(true);
    setError(null);
    void sound().resume();
    try {
      const response = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatar, rgToken: getIncomingPlatformToken() }),
      });
      const body = (await response.json()) as {
        token?: string;
        playerId?: string;
        error?: string;
      };
      if (!response.ok || !body.token || !body.playerId) {
        setError(body.error ?? 'Impossible de rejoindre cette salle.');
        return;
      }
      saveIdentity({ name, avatar });
      saveSession({ code, token: body.token, playerId: body.playerId });
      onJoined();
    } catch {
      setError('Connexion impossible. Vérifiez votre réseau.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="felt-surface felt-grain relative min-h-dvh w-full">
      <div className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="panel rounded-3xl p-6"
        >
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.3em] text-gold-500/70">
            Rejoindre la table
          </p>
          <p className="text-gradient-gold mb-5 font-display text-5xl tracking-[0.2em]">{code}</p>

          {joinable ? (
            <>
              {platformUsername && (
                <p className="mb-3 rounded-xl border border-gold-500/25 bg-gold-500/10 px-3 py-2 text-center text-[0.78rem] text-gold-300">
                  Connecté en tant que <strong>{platformUsername}</strong>
                </p>
              )}
              <IdentityPicker
                name={name}
                avatar={avatar}
                onName={setName}
                onAvatar={setAvatar}
                autoFocus
              />
              {error && (
                <p className="mt-3 rounded-xl border border-ruby-400/30 bg-ruby-600/15 px-3 py-2 text-[0.82rem] text-ruby-400">
                  {error}
                </p>
              )}
              <Button
                variant="primary"
                size="lg"
                block
                className="mt-5"
                disabled={name.trim().length < 2 || busy}
                onClick={join}
              >
                {busy ? 'Connexion…' : 'Rejoindre la partie'}
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[0.92rem] leading-relaxed text-cream/60">
                Cette partie a déjà commencé ou la table est complète.
              </p>
              <Link href="/">
                <Button variant="secondary" block>
                  Créer ma propre partie
                </Button>
              </Link>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <Centered>
      <motion.div
        animate={{ rotate: [0, 8, -6, 0], y: [0, -6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        className="text-5xl"
        aria-hidden="true"
      >
        🂡
      </motion.div>
      <p className="text-[0.86rem] uppercase tracking-[0.22em] text-cream/45">{label}</p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="felt-surface felt-grain grid min-h-dvh w-full place-items-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">{children}</div>
    </div>
  );
}
