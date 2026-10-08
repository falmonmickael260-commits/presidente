import { QUEEN_OF_SPADES } from './cards';
import { createRng } from './rng';
import { getTableTop, legalCombos, worstCards } from './rules';
import type { GameAction, GameState } from './types';

/**
 * Stratégie de bot : simple, lisible, et suffisamment crédible pour jouer seul
 * ou compléter une table. Elle n'a accès qu'à sa propre main.
 */
export function decideBotAction(state: GameState, botId: string): GameAction | null {
  if (state.phase === 'exchange' && state.exchange) {
    const transfer = state.exchange.transfers.find(
      (t) => t.fromId === botId && t.cardIds === null && t.mode === 'choice',
    );
    if (transfer) {
      const bot = state.players.find((p) => p.id === botId);
      if (!bot) return null;
      return {
        type: 'exchange_give',
        playerId: botId,
        cardIds: worstCards(bot.hand, transfer.count).map((c) => c.id),
      };
    }
    return null;
  }

  if (state.phase !== 'playing' || state.currentPlayerId !== botId) return null;
  const bot = state.players.find((p) => p.id === botId);
  if (!bot || bot.finishPosition !== null || bot.passed) return null;

  const top = getTableTop(state);
  const mustQueen = state.mustOpenWithQueenOfSpades && state.pile.length === 0;
  const options = legalCombos(bot.hand, top, {
    allowEqualRank: state.settings.allowEqualRank,
    requireQueenOfSpades: mustQueen,
    exactRankOnly: state.skipThreat,
  });

  if (state.skipThreat) {
    // Menace de saut : reposer la valeur exacte est toujours préférable — on
    // se défait de cartes, on reste maître du pli et le saut glisse au suivant.
    const match = options[0];
    if (!match) return { type: 'skip', playerId: botId };
    return { type: 'play', playerId: botId, cardIds: match.cards.map((c) => c.id) };
  }

  if (options.length === 0) {
    return top ? { type: 'pass', playerId: botId } : null;
  }

  const rng = createRng(state.version * 2654435761 + bot.seat + 1);

  if (mustQueen) {
    const withQueen =
      options.find((c) => c.cards.some((card) => card.id === QUEEN_OF_SPADES)) ??
      options[0];
    return { type: 'play', playerId: botId, cardIds: withQueen.cards.map((c) => c.id) };
  }

  if (!top) {
    // Main libre : on se débarrasse des valeurs basses, en gardant les carrés au chaud.
    const lowestRank = options[0].rank;
    const sameRank = options.filter((c) => c.rank === lowestRank);
    const finisher = options.find((c) => c.count === bot.hand.length);
    const pick =
      finisher ??
      sameRank.find((c) => c.count === Math.min(2, sameRank.length)) ??
      sameRank[0];
    return { type: 'play', playerId: botId, cardIds: pick.cards.map((c) => c.id) };
  }

  const cheapest = options[0];
  const finishesHand = cheapest.count === bot.hand.length;

  // On conserve les très fortes cartes tant que la manche n'est pas avancée.
  const isPremium = cheapest.rank >= 14;
  if (!finishesHand && isPremium && bot.hand.length > 3 && rng() < 0.7) {
    return { type: 'pass', playerId: botId };
  }

  return { type: 'play', playerId: botId, cardIds: cheapest.cards.map((c) => c.id) };
}
