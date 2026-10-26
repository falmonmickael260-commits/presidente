'use client';

/**
 * Code de salle reçu en paramètre d'URL `rg_room` quand la coquille Revanche
 * Games ouvre ce jeu à la suite d'une invitation acceptée.
 *
 * Même principe que `rg_token` (voir platformToken.ts) : lu une fois à
 * l'ouverture, mis en cache en `sessionStorage`, puis retiré de l'URL visible.
 * Le cache sert au cas où la page est rechargée avant d'avoir rejoint la
 * salle ; il est consommé dès qu'on entre effectivement dans une salle, pour
 * qu'une invitation ancienne ne ramène pas le joueur dans une partie finie.
 *
 * Aucune confiance accordée à cette valeur : c'est le serveur du jeu qui dira
 * si la salle existe encore et si elle accepte un joueur de plus. Un code
 * absent ou invalide ramène simplement l'écran d'accueil habituel.
 */

import { normalizeRoomCode } from './roomCode';

const STORAGE_KEY = 'rg_room';
let cached: string | null | undefined;

export function getIncomingRoomCode(): string | null {
  if (typeof window === 'undefined') return null;
  if (cached !== undefined) return cached;

  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('rg_room');

  if (fromUrl) {
    const normalized = normalizeRoomCode(fromUrl);
    // Le paramètre est retiré de l'URL même s'il est illisible : il n'a rien
    // à faire dans la barre d'adresse, ni dans un lien partagé ensuite.
    params.delete('rg_room');
    const clean = window.location.pathname + (params.size ? `?${params}` : '');
    window.history.replaceState({}, '', clean);

    if (normalized.length >= 4) {
      try {
        sessionStorage.setItem(STORAGE_KEY, normalized);
      } catch {
        /* stockage indisponible (navigation privée) — valeur gardée en mémoire */
      }
      cached = normalized;
      return cached;
    }

    cached = null;
    return null;
  }

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    cached = stored && stored.length >= 4 ? stored : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Oublie l'invitation, une fois le joueur entré dans une salle.
 *
 * Sans cela, revenir à l'accueil puis rafraîchir le renverrait indéfiniment
 * vers la salle de l'invitation, même après l'avoir quittée.
 */
export function clearIncomingRoomCode(): void {
  cached = null;
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* rien à nettoyer */
  }
}
