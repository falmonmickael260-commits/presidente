import { QUEEN_OF_SPADES, comboLabel } from './cards';
import type {
  Card,
  CardId,
  Combo,
  ComboKind,
  GameState,
  Player,
  Rank,
} from './types';

const KIND_BY_COUNT: Record<number, ComboKind> = {
  1: 'single',
  2: 'pair',
  3: 'triple',
  4: 'quad',
};

/**
 * Reconnaît une combinaison : 1, 2, 3 ou 4 cartes **de même valeur**.
 * Retourne `null` si la sélection n'est pas une combinaison jouable.
 */
export function getCombo(cards: readonly Card[]): Combo | null {
  if (cards.length < 1 || cards.length > 4) return null;
  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) return null;
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== cards.length) return null;
  return {
    kind: KIND_BY_COUNT[cards.length],
    rank,
    count: cards.length,
    cards: cards.slice(),
  };
}

export interface TableTop {
  rank: Rank;
  count: number;
}

/** Combinaison à battre, ou `null` si la main est libre. */
export function getTableTop(state: GameState): TableTop | null {
  const last = state.pile[state.pile.length - 1];
  if (!last || state.requiredCount === null) return null;
  return { rank: last.rank, count: state.requiredCount };
}

/**
 * Une combinaison peut-elle être posée sur la table ?
 * - même nombre de cartes que le pli en cours ;
 * - valeur strictement supérieure (ou égale si le réglage l'autorise).
 */
export function canBeat(
  combo: Combo,
  top: TableTop | null,
  allowEqualRank: boolean,
): boolean {
  if (!top) return true;
  if (combo.count !== top.count) return false;
  return allowEqualRank ? combo.rank >= top.rank : combo.rank > top.rank;
}

/** Nombre de cartes de la valeur dominante déjà présentes dans le pli courant. */
export function countTopRankOnTable(state: GameState): number {
  const top = getTableTop(state);
  if (!top) return 0;
  return state.pile
    .filter((set) => set.rank === top.rank)
    .reduce((sum, set) => sum + set.cards.length, 0);
}

/** Les quatre cartes d'une même valeur sont-elles sur la table ? → pli fermé d'office. */
export function isCarreOnTable(state: GameState): boolean {
  return countTopRankOnTable(state) >= 4;
}

export type MoveRejection =
  | 'not_playing'
  | 'not_your_turn'
  | 'already_finished'
  | 'already_passed'
  | 'empty_selection'
  | 'unknown_card'
  | 'not_owned'
  | 'not_same_rank'
  | 'wrong_count'
  | 'too_weak'
  | 'must_open_with_queen'
  | 'must_match_rank'
  | 'cannot_pass_on_free_hand'
  | 'no_skip_pending';

export interface MoveCheckOk {
  ok: true;
  combo: Combo;
}
export interface MoveCheckError {
  ok: false;
  reason: MoveRejection;
  message: string;
}
export type MoveCheck = MoveCheckOk | MoveCheckError;

const MESSAGES: Record<MoveRejection, string> = {
  not_playing: "La partie n'est pas en cours.",
  not_your_turn: "Ce n'est pas votre tour.",
  already_finished: 'Vous avez déjà terminé cette manche.',
  already_passed: 'Vous avez passé : vous ne pouvez plus jouer sur ce pli.',
  empty_selection: 'Sélectionnez au moins une carte.',
  unknown_card: 'Carte inconnue.',
  not_owned: "Cette carte n'est pas dans votre main.",
  not_same_rank: 'Une combinaison doit être composée de cartes de même valeur.',
  wrong_count: 'Vous devez poser le même nombre de cartes que le pli en cours.',
  too_weak: 'Votre combinaison doit être plus forte que celle sur la table.',
  must_open_with_queen: 'La partie démarre sur la Dame de pique : elle doit être posée.',
  must_match_rank: 'Vous ne pouvez que reposer la même valeur, ou sauter votre tour.',
  cannot_pass_on_free_hand: 'Vous avez la main : vous devez poser une combinaison.',
  no_skip_pending: "Vous n'êtes pas sous la menace du saut.",
};

function reject(reason: MoveRejection, message?: string): MoveCheckError {
  return { ok: false, reason, message: message ?? MESSAGES[reason] };
}

export function findPlayer(state: GameState, playerId: string): Player | undefined {
  return state.players.find((p) => p.id === playerId);
}

/**
 * Fonction centrale de validation d'un coup.
 * Volontairement indépendante de l'interface : elle est testée unitairement.
 */
export function validatePlay(
  state: GameState,
  playerId: string,
  cardIds: readonly CardId[],
): MoveCheck {
  if (state.phase !== 'playing') return reject('not_playing');
  const player = findPlayer(state, playerId);
  if (!player) return reject('not_your_turn');
  if (player.finishPosition !== null) return reject('already_finished');
  if (state.currentPlayerId !== playerId) return reject('not_your_turn');
  if (player.passed) return reject('already_passed');
  if (cardIds.length === 0) return reject('empty_selection');

  const unique = new Set(cardIds);
  if (unique.size !== cardIds.length) return reject('not_owned');

  const cards: Card[] = [];
  for (const id of cardIds) {
    const owned = player.hand.find((c) => c.id === id);
    if (!owned) return reject('not_owned');
    cards.push(owned);
  }

  const combo = getCombo(cards);
  if (!combo) {
    return cards.length > 4 ? reject('wrong_count') : reject('not_same_rank');
  }

  const top = getTableTop(state);
  if (top && combo.count !== top.count) {
    return reject(
      'wrong_count',
      `Vous devez poser ${top.count} carte${top.count > 1 ? 's' : ''}.`,
    );
  }
  if (!canBeat(combo, top, state.settings.allowEqualRank)) {
    return reject(
      'too_weak',
      `Il faut au moins ${comboLabel(top!.rank, top!.count)}${
        state.settings.allowEqualRank ? '' : ' (strictement supérieur)'
      }.`,
    );
  }

  // Sous la menace du saut, la seule pose possible est la valeur exacte.
  if (state.skipThreat && top && combo.rank !== top.rank) {
    return reject(
      'must_match_rank',
      `Il faut reposer ${comboLabel(top.rank, top.count)} ou sauter votre tour.`,
    );
  }

  if (
    state.mustOpenWithQueenOfSpades &&
    state.pile.length === 0 &&
    !cardIds.includes(QUEEN_OF_SPADES)
  ) {
    return reject('must_open_with_queen');
  }

  return { ok: true, combo };
}

/** Combinaison vide : « passer » et « sauter » ne posent aucune carte. */
function emptyCombo(): Combo {
  return { kind: 'single', rank: 3, count: 0, cards: [] };
}

function checkTurn(state: GameState, playerId: string): MoveCheckError | null {
  if (state.phase !== 'playing') return reject('not_playing');
  const player = findPlayer(state, playerId);
  if (!player) return reject('not_your_turn');
  if (player.finishPosition !== null) return reject('already_finished');
  if (state.currentPlayerId !== playerId) return reject('not_your_turn');
  if (player.passed) return reject('already_passed');
  return null;
}

export function validatePass(state: GameState, playerId: string): MoveCheck {
  const turn = checkTurn(state, playerId);
  if (turn) return turn;
  if (state.pile.length === 0) return reject('cannot_pass_on_free_hand');
  // Sous la menace du saut, c'est « sauter » qu'il faut jouer, pas « passer » :
  // sauter ne sort pas du pli, passer si.
  if (state.skipThreat) return reject('must_match_rank');
  return { ok: true, combo: emptyCombo() };
}

/** Accepter le saut : le joueur perd son tour mais reste dans le pli. */
export function validateSkip(state: GameState, playerId: string): MoveCheck {
  const turn = checkTurn(state, playerId);
  if (turn) return turn;
  if (!state.skipThreat) return reject('no_skip_pending');
  return { ok: true, combo: emptyCombo() };
}

/**
 * Toutes les combinaisons légales d'une main face à la table.
 * Sert aux indices d'interface, à l'auto-jeu sur expiration et aux bots.
 */
export function legalCombos(
  hand: readonly Card[],
  top: TableTop | null,
  options: {
    allowEqualRank: boolean;
    requireQueenOfSpades?: boolean;
    /** Sous la menace du saut : seule la valeur exacte est jouable. */
    exactRankOnly?: boolean;
  },
): Combo[] {
  const byRank = new Map<Rank, Card[]>();
  for (const card of hand) {
    const list = byRank.get(card.rank);
    if (list) list.push(card);
    else byRank.set(card.rank, [card]);
  }

  const result: Combo[] = [];
  for (const [rank, cards] of byRank) {
    if (options.exactRankOnly && top && rank !== top.rank) continue;
    const maxCount = cards.length;
    const counts = top ? [top.count] : [1, 2, 3, 4];
    for (const count of counts) {
      if (count > maxCount) continue;
      const combo = getCombo(cards.slice(0, count));
      if (!combo) continue;
      if (!canBeat(combo, top, options.allowEqualRank)) continue;
      if (
        options.requireQueenOfSpades &&
        !combo.cards.some((c) => c.id === QUEEN_OF_SPADES)
      ) {
        // On tente de forcer la Dame de pique dans la combinaison.
        const withQueen = cards.filter((c) => c.id === QUEEN_OF_SPADES);
        if (withQueen.length === 0) continue;
        const others = cards.filter((c) => c.id !== QUEEN_OF_SPADES);
        const forced = getCombo([...withQueen, ...others.slice(0, count - 1)]);
        if (forced && canBeat(forced, top, options.allowEqualRank)) result.push(forced);
        continue;
      }
      result.push(combo);
    }
  }

  return result.sort((a, b) => a.rank - b.rank || a.count - b.count);
}

/** Les N meilleures cartes d'une main (échange Trou du Cul → Président). */
export function bestCards(hand: readonly Card[], count: number): Card[] {
  return hand
    .slice()
    .sort((a, b) => b.rank - a.rank)
    .slice(0, count);
}

/** Les N plus faibles cartes d'une main (choix par défaut si le temps expire). */
export function worstCards(hand: readonly Card[], count: number): Card[] {
  return hand
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, count);
}
