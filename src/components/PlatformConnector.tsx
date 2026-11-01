'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { connectPlatform } from '../../platform-connector/browser.js';
import { loadSession, saveSession } from '@/lib/session';

export function PlatformConnector() {
  const router = useRouter();
  useEffect(() => connectPlatform({
    game: 'president',
    session: () => { const code = location.pathname.match(/^\/salle\/([A-Za-z0-9_-]+)/)?.[1]; return code ? loadSession(code) : null; },
    adopt: async session => {
      if (!session.token || !session.playerId) throw new Error('Session invalide.');
      saveSession({ code: session.code, token: session.token, playerId: session.playerId });
      router.replace(`/salle/${encodeURIComponent(session.code)}`);
    },
  }), [router]);
  return null;
}
