/**
 * Types du domaine « Le Président ».
 * Ce module est volontairement pur : aucune dépendance React, réseau ou DOM.
 */

export type Suit = 'S' | 'H' | 'D' | 'C';

/**
 * Force d'une carte. L'ordre du jeu est 3 < 4 < ... < 10 < V < D < R < A < 2.
 * On encode donc le 2 comme la valeur la plus haute (15).
 */
export type Rank = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

/** Identifiant stable et unique d'une carte dans un jeu de 52 (ex. `12S` = Dame de pique). */
export type CardId = string;

export interface Card {
  id: CardId;
  rank: Rank;
  suit: Suit;
}

export type ComboKind = 'single' | 'pair' | 'triple' | 'quad';

export interface Combo {
  kind: ComboKind;
  rank: Rank;
  count: number;
  cards: Card[];
}

export type Role =
  | 'president'
  | 'vice_president'
  | 'neutre'
  | 'vice_trou'
  | 'trou_du_cul';

export type Phase =
  | 'lobby'
  | 'dealing'
  | 'exchange'
  | 'playing'
  | 'round_end'
  | 'game_over';

export interface Player {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  /** Main privée. Jamais transmise aux autres clients (voir `view.ts`). */
  hand: Card[];
  /** A passé pour le pli en cours. */
  passed: boolean;
  /** Position de fin de manche (0 = Président), `null` tant que le joueur a des cartes. */
  finishPosition: number | null;
  /** Rôle hérité de la manche précédente. */
  role: Role | null;
  score: number;
}

export interface PlayedSet {
  /** Identifiant unique de la pose, utile pour les clés React et la déduplication. */
  id: string;
  playerId: string;
  cards: Card[];
  rank: Rank;
  /** Index d'ordre dans le pli, sert au décalage/rotation visuels. */
  order: number;
}

export interface ExchangeTransfer {
  fromId: string;
  toId: string;
  count: number;
  /** `auto` : les meilleures cartes partent d'office. `choice` : le donneur choisit. */
  mode: 'auto' | 'choice';
  cardIds: CardId[] | null;
}

export interface ExchangeState {
  transfers: ExchangeTransfer[];
  deadline: number | null;
}

export interface GameSettings {
  /** Durée d'un tour en secondes. */
  turnSeconds: number;
  /** Autorise de reposer la même valeur (nécessaire aux carrés cumulés). */
  allowEqualRank: boolean;
  /**
   * Reposer la même valeur **sur une carte seule** fait sauter son tour au
   * joueur suivant — sauf si celui-ci repose à son tour cette valeur, ce qui
   * reporte le saut sur le joueur d'après. Les paires et les brelans se
   * jouent normalement. N'a de sens que si `allowEqualRank` est actif.
   */
  skipOnEqual: boolean;
  /** Nombre de manches de la partie. */
  rounds: number;
}

export interface GameState {
  phase: Phase;
  roundNumber: number;
  players: Player[];
  settings: GameSettings;
  /** Joueur dont c'est le tour. */
  currentPlayerId: string | null;
  /** Poses du pli courant, de la plus ancienne à la plus récente. */
  pile: PlayedSet[];
  /** Nombre de cartes imposé par le pli en cours (`null` = main libre). */
  requiredCount: number | null;
  /** Dernier joueur à avoir posé : il remporte le pli si tout le monde passe. */
  lastPlayerId: string | null;
  /** Ordre de sortie de la manche (ids de joueurs). */
  finishOrder: string[];
  exchange: ExchangeState | null;
  /** Fin du tour courant (timestamp ms), utilisé par le timer serveur. */
  turnDeadline: number | null;
  /** Durée allouée au tour courant : un joueur déconnecté a un délai réduit. */
  turnTotalMs: number | null;
  /** Fin d'une phase temporisée (distribution, fin de manche). */
  phaseEndsAt: number | null;
  /** Compteur monotone incrémenté à chaque mutation : détection de désynchronisation. */
  version: number;
  /** État du générateur pseudo-aléatoire (parties reproductibles). */
  seed: number;
  /** Le premier pli de la toute première manche doit contenir la Dame de pique. */
  mustOpenWithQueenOfSpades: boolean;
  /**
   * Le joueur courant est sous la menace du saut : il ne peut que reposer
   * exactement la même valeur (carte seule), ou laisser passer son tour.
   * Contrairement à un « passe », sauter ne le sort pas du pli.
   */
  skipThreat: boolean;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export type GameAction =
  | { type: 'start_game'; playerId: string }
  | { type: 'play'; playerId: string; cardIds: CardId[] }
  | { type: 'pass'; playerId: string }
  | { type: 'skip'; playerId: string }
  | { type: 'exchange_give'; playerId: string; cardIds: CardId[] }
  | { type: 'next_round'; playerId: string }
  | { type: 'restart'; playerId: string }
  | { type: 'tick' };

/* ------------------------------------------------------------------ */
/* Événements (pilotent le motion design côté client)                  */
/* ------------------------------------------------------------------ */

export interface StandingEntry {
  playerId: string;
  position: number;
  role: Role;
  points: number;
}

export type GameEvent =
  | { type: 'round_start'; roundNumber: number; hands: Record<string, number> }
  | { type: 'deal'; roundNumber: number; perPlayer: Record<string, number> }
  | { type: 'exchange_start' }
  | {
      type: 'exchange_transfer';
      fromId: string;
      toId: string;
      count: number;
      cardIds: CardId[];
    }
  | { type: 'turn'; playerId: string; deadline: number | null }
  | {
      type: 'play';
      playerId: string;
      cards: Card[];
      combo: ComboKind;
      setId: string;
      isQueenOpening: boolean;
    }
  | { type: 'pass'; playerId: string }
  | { type: 'skipped'; playerId: string; rank: Rank }
  | { type: 'carre'; playerId: string; rank: Rank }
  | {
      type: 'trick_won';
      playerId: string;
      reason: 'all_passed' | 'carre' | 'alone';
    }
  | { type: 'player_finished'; playerId: string; position: number; role: Role }
  | { type: 'round_end'; standings: StandingEntry[] }
  | { type: 'game_over'; standings: StandingEntry[] }
  | { type: 'timeout'; playerId: string };

/** Événement horodaté tel qu'il transite sur le fil temps réel. */
export interface StampedEvent {
  seq: number;
  at: number;
  event: GameEvent;
}
