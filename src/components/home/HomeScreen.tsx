'use client';

import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { parseCardId } from '@/game/cards';
import { PlayingCard } from '@/components/card/PlayingCard';
import { IdentityPicker } from '@/components/lobby/IdentityPicker';
import { RulesSheet } from '@/components/game/RulesSheet';
import { Button } from '@/components/ui/Button';
import { AVATARS, randomAvatar } from '@/lib/avatars';
import { loadIdentity, saveIdentity, saveSession } from '@/lib/session';
import { getIncomingPlatformToken, peekPlatformUsername } from '@/lib/platformToken';
import { clearIncomingRoomCode, getIncomingRoomCode } from '@/lib/platformRoom';
import { sound } from '@/lib/sound';
import { normalizeRoomCode } from '@/lib/roomCode';

const HERO_CARDS = ['12S', '15H', '14C'];

/** Éventail de présentation : trois cartes qui respirent et réagissent au pointeur. */
function HeroCards() {
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateY = useSpring(useTransform(pointerX, [-1, 1], [10, -10]), {
    stiffness: 120,
    damping: 20,
  });
  const rotateX = useSpring(useTransform(pointerY, [-1, 1], [-8, 8]), {
    stiffness: 120,
    damping: 20,
  });

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointerX.set((event.clientX / window.innerWidth) * 2 - 1);
      pointerY.set((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [pointerX, pointerY]);

  return (
    <div className="stage-3d pointer-events-none relative mx-auto h-[150px] w-full max-w-[320px] sm:h-[200px]">
      <motion.div
        className="absolute inset-0 grid place-items-center"
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      >
        {HERO_CARDS.map((id, index) => {
          const card = parseCardId(id);
          if (!card) return null;
          const offset = index - 1;
          return (
            <motion.div
              key={id}
              className="absolute will-animate"
              style={{ zIndex: 10 - Math.abs(offset) }}
              initial={{ y: 60, opacity: 0, rotate: 0, scale: 0.85 }}
              animate={{
                y: [0, -7 - Math.abs(offset) * 2, 0],
                x: offset * 74,
                opacity: 1,
                rotate: offset * 11,
                scale: 1,
              }}
              transition={{
                y: {
                  duration: 4.6 + index * 0.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: index * 0.3,
                },
                opacity: { duration: 0.6, delay: 0.1 + index * 0.12 },
                x: { type: 'spring', stiffness: 160, damping: 22, delay: 0.1 + index * 0.12 },
                rotate: { type: 'spring', stiffness: 160, damping: 22, delay: 0.1 + index * 0.12 },
                scale: { type: 'spring', stiffness: 200, damping: 20, delay: 0.1 + index * 0.12 },
              }}
            >
              <PlayingCard card={card} width={104} elevation="fly" />
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

export function HomeScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [platformUsername, setPlatformUsername] = useState<string | null>(null);

  // Un seul effet au montage : l'identité et l'éventuelle invitation doivent
  // être résolues ensemble, sinon l'entrée automatique en salle se jouerait
  // avant de connaître le pseudonyme.
  useEffect(() => {
    const username = peekPlatformUsername(getIncomingPlatformToken());
    setPlatformUsername(username);

    const identity = loadIdentity();
    const resolvedAvatar = identity?.avatar ?? randomAvatar();

    // Le pseudonyme du compte Revanche Games prime sur celui stocké
    // localement : c'est lui qui apparaîtra dans les statistiques, et le
    // joueur n'a pas à le re-saisir à chaque lancement. Il reste modifiable.
    // `slice(16)` : la limite du champ de saisie, alors qu'un pseudonyme de
    // plateforme peut aller jusqu'à 24 caractères.
    const resolvedName = (username ?? identity?.name ?? '').slice(0, 16);

    setName(resolvedName);
    setAvatar(resolvedAvatar);

    const invitedRoom = getIncomingRoomCode();
    if (!invitedRoom) return;

    setCode(invitedRoom);

    // Invitation acceptée depuis la plateforme : on entre directement, sans
    // faire retaper le code. Sans pseudonyme utilisable (joueur invité), on
    // se contente de pré-remplir le champ — il reste un clic à faire.
    if (resolvedName.trim().length >= 2) {
      saveIdentity({ name: resolvedName, avatar: resolvedAvatar });
      clearIncomingRoomCode();
      router.push(`/salle/${invitedRoom}`);
    }
  }, [router]);

  const create = async () => {
    setBusy('create');
    setError(null);
    void sound().resume();
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatar, rgToken: getIncomingPlatformToken() }),
      });
      const body = (await response.json()) as {
        code?: string;
        token?: string;
        playerId?: string;
        error?: string;
      };
      if (!response.ok || !body.code || !body.token || !body.playerId) {
        setError(body.error ?? 'Impossible de créer la partie.');
        return;
      }
      saveIdentity({ name, avatar });
      saveSession({ code: body.code, token: body.token, playerId: body.playerId });
      clearIncomingRoomCode();
      router.push(`/salle/${body.code}`);
    } catch {
      setError('Connexion impossible. Vérifiez votre réseau.');
    } finally {
      setBusy(null);
    }
  };

  const join = () => {
    const normalized = normalizeRoomCode(code);
    if (normalized.length < 4) {
      setError('Entrez un code de salle valide.');
      return;
    }
    setBusy('join');
    if (name.trim().length >= 2) saveIdentity({ name, avatar });
    clearIncomingRoomCode();
    router.push(`/salle/${normalized}`);
  };

  const nameValid = name.trim().length >= 2;

  return (
    <main className="felt-surface felt-grain relative min-h-dvh w-full overflow-x-hidden">
      <div className="pt-safe pb-safe relative mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
        <header className="text-center">
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-[0.62rem] font-bold uppercase tracking-[0.42em] text-gold-500/70"
          >
            Jeu de cartes en ligne
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22 }}
            className="text-gradient-gold font-display text-[clamp(2.8rem,13vw,4.2rem)] leading-[0.95]"
          >
            Le Président
          </motion.h1>
          <div className="gold-rule mx-auto mt-3 h-px w-40" />
        </header>

        <HeroCards />

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="text-center text-[0.9rem] leading-relaxed text-cream/55"
        >
          3 à 8 joueurs, en temps réel.
          <br />
          Videz votre main avant les autres pour devenir Président.
        </motion.p>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 220, damping: 26 }}
          className="panel rounded-3xl p-5"
        >
          {platformUsername && (
            <p className="mb-3 rounded-xl border border-gold-500/25 bg-gold-500/10 px-3 py-2 text-center text-[0.78rem] text-gold-300">
              Connecté en tant que <strong>{platformUsername}</strong> — vos résultats compteront
              dans vos statistiques Revanche Game.
            </p>
          )}
          {!platformUsername && code.length >= 4 && (
            <p className="mb-3 rounded-xl border border-gold-500/25 bg-gold-500/10 px-3 py-2 text-center text-[0.78rem] text-gold-300">
              Vous êtes invité dans la salle <strong>{code}</strong> — choisissez un pseudo, puis
              « Rejoindre ».
            </p>
          )}
          <IdentityPicker name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} />

          {error && (
            <p className="mt-3 rounded-xl border border-ruby-400/30 bg-ruby-600/15 px-3 py-2 text-[0.82rem] text-ruby-400">
              {error}
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            block
            className="mt-4"
            disabled={!nameValid || busy !== null}
            onClick={create}
          >
            {busy === 'create' ? 'Création…' : 'Créer une partie'}
          </Button>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[0.66rem] uppercase tracking-[0.2em] text-cream/30">ou</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <div className="flex gap-2">
            <input
              value={code}
              onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
              placeholder="CODE"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              aria-label="Code de la salle"
              className="h-12 min-w-0 flex-1 rounded-2xl border border-white/12 bg-ink-950/45 px-4 text-center font-display text-2xl tracking-[0.3em] text-gold-300 placeholder:tracking-[0.2em] placeholder:text-cream/20 focus:border-gold-500/50 focus:outline-none"
            />
            <Button
              variant="secondary"
              size="lg"
              disabled={code.length < 4 || busy !== null}
              onClick={join}
            >
              Rejoindre
            </Button>
          </div>
        </motion.section>

        <div className="mt-auto flex flex-col items-center gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => setRulesOpen(true)}>
            Découvrir les règles
          </Button>
          <p className="text-center text-[0.68rem] text-cream/25">
            Aucun compte requis · Partagez simplement le code de la salle
          </p>
        </div>
      </div>

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </main>
  );
}
