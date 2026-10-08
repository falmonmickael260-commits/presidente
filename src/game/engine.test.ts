import { describe, expect, it } from 'vitest';
import {
  DEAL_MS,
  DISCONNECTED_TURN_MS,
  addPlayer,
  createGame,
  reduce,
  removePlayer,
  roleForPosition,
  setConnected,
  startRound,
  tick,
} from './engine';
import { decideBotAction } from './bot';
import { buildPlayerView } from './view';
import type { GameState } from './types';
import { gameWithPlayers, pass, play, playingGame, skip } from './testUtils';

const ids = (state: GameState, playerId: string) =>
  state.players.find((p) => p.id === playerId)!;

describe('lobby', () => {
  it('nomme le premier joueur hôte et refuse au-delà de 8 joueurs', () => {
    let state = gameWithPlayers(8);
    expect(state.players[0].isHost).toBe(true);
    state = addPlayer(state, { id: 'p8', name: 'Neuf', avatar: '🐍' });
    expect(state.players).toHaveLength(8);
  });

  it('refuse de démarrer à moins de 3 joueurs', () => {
    const state = gameWithPlayers(2);
    const result = reduce(state, { type: 'start_game', playerId: 'p0' }, 0);
    expect(result.state.phase).toBe('lobby');
  });

  it('refuse de démarrer si le demandeur n’est pas l’hôte', () => {
    const state = gameWithPlayers(4);
    const result = reduce(state, { type: 'start_game', playerId: 'p2' }, 0);
    expect(result.state.phase).toBe('lobby');
  });
});

describe('distribution', () => {
  it('passe par une phase de distribution animée puis donne la main', () => {
    const state = gameWithPlayers(4);
    const dealt = reduce(state, { type: 'start_game', playerId: 'p0' }, 0).state;
    expect(dealt.phase).toBe('dealing');
    expect(dealt.players.every((p) => p.hand.length === 13)).toBe(true);

    const playing = tick(dealt, DEAL_MS).state;
    expect(playing.phase).toBe('playing');
    expect(playing.currentPlayerId).not.toBeNull();
  });

  it('donne la main au porteur de la Dame de pique lors de la première manche', () => {
    const state = gameWithPlayers(5);
    const dealt = startRound(state, 0).state;
    const playing = tick(dealt, DEAL_MS).state;
    const opener = ids(playing, playing.currentPlayerId!);
    expect(opener.hand.some((c) => c.id === '12S')).toBe(true);
    expect(playing.mustOpenWithQueenOfSpades).toBe(true);
  });
});

describe('déroulement d’un pli', () => {
  it('impose le nombre de cartes du pli', () => {
    let state = playingGame({ p0: ['8H', '8S'], p1: ['13D', '10H'], p2: ['3D', '4C'] });
    state = play(state, 'p0', '8H', '8S').state;
    expect(state.currentPlayerId).toBe('p1');

    const rejected = play(state, 'p1', '13D').state;
    expect(rejected.pile).toHaveLength(1);
    expect(rejected.currentPlayerId).toBe('p1');
  });

  it('ferme le pli quand tous les autres ont passé et rend la main libre', () => {
    let state = playingGame({ p0: ['8H', '3S'], p1: ['13D', '4H'], p2: ['9D', '5C'] });
    state = play(state, 'p0', '8H').state;
    state = pass(state, 'p1').state;
    state = pass(state, 'p2').state;

    expect(state.pile).toHaveLength(0);
    expect(state.requiredCount).toBeNull();
    expect(state.currentPlayerId).toBe('p0');
    expect(state.players.every((p) => !p.passed)).toBe(true);
  });

  it('laisse le gagnant du pli repartir avec n’importe quelle combinaison', () => {
    let state = playingGame({
      p0: ['8H', '3S', '3D', '3C'],
      p1: ['13D', '4H'],
      p2: ['9D', '5C'],
    });
    state = play(state, 'p0', '8H').state;
    state = pass(state, 'p1').state;
    state = pass(state, 'p2').state;
    const after = play(state, 'p0', '3S', '3D', '3C').state;
    expect(after.pile).toHaveLength(1);
    expect(after.requiredCount).toBe(3);
  });

  it('empêche un joueur ayant passé de rejouer sur le même pli', () => {
    let state = playingGame({
      p0: ['8H', '3S'],
      p1: ['13D', '4H'],
      p2: ['9D', '5C'],
      p3: ['14D', '6C'],
    });
    state = play(state, 'p0', '8H').state;
    state = pass(state, 'p1').state;
    state = play(state, 'p2', '9D').state;
    expect(state.currentPlayerId).toBe('p3');
    const attempt = play(state, 'p1', '13D').state;
    expect(attempt.pile).toHaveLength(2);
  });

  it('interdit de passer quand on a la main', () => {
    const state = playingGame({ p0: ['8H'], p1: ['13D'], p2: ['9D'] });
    const result = pass(state, 'p0').state;
    expect(result.currentPlayerId).toBe('p0');
    expect(result.players.every((p) => !p.passed)).toBe(true);
  });
});

describe('carré', () => {
  it('ferme immédiatement le pli et rend la main au poseur', () => {
    let state = playingGame({
      p0: ['5H', '5S', '5D', '5C', '3H'],
      p1: ['13D', '4H'],
      p2: ['9D', '6C'],
    });
    const result = play(state, 'p0', '5H', '5S', '5D', '5C');
    expect(result.events.some((e) => e.type === 'carre')).toBe(true);
    expect(result.events.some((e) => e.type === 'trick_won' && e.reason === 'carre')).toBe(
      true,
    );
    expect(result.state.pile).toHaveLength(0);
    expect(result.state.currentPlayerId).toBe('p0');
  });

  it('ferme aussi le pli sur un carré cumulé (5 → 5 → 5 → 5)', () => {
    let state = playingGame(
      { p0: ['5H', '3S'], p1: ['5S', '4H'], p2: ['5D', '6C'], p3: ['5C', '7C'] },
      { allowEqualRank: true },
    );
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;
    state = play(state, 'p2', '5D').state;
    const result = play(state, 'p3', '5C');
    expect(result.events.some((e) => e.type === 'carre')).toBe(true);
    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.state.pile).toHaveLength(0);
    // Le pli fermé désarme la menace de saut accumulée au fil des 5.
    expect(result.state.skipThreat).toBe(false);
  });
});

describe('saut sur valeur égale', () => {
  it('reposer la même valeur arme le saut du joueur suivant', () => {
    let state = playingGame({
      p0: ['5H', '3S'],
      p1: ['5S', '4H'],
      p2: ['9D', '6C'],
      p3: ['13C', '7C'],
    });
    state = play(state, 'p0', '5H').state;
    expect(state.skipThreat).toBe(false);

    state = play(state, 'p1', '5S').state;
    expect(state.skipThreat).toBe(true);
    expect(state.currentPlayerId).toBe('p2');
  });

  it('refuse toute autre valeur au joueur menacé, même plus forte', () => {
    let state = playingGame({
      p0: ['5H', '3S'],
      p1: ['5S', '4H'],
      p2: ['9D', '6C'],
      p3: ['13C', '7C'],
    });
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;

    const refused = play(state, 'p2', '9D');
    expect(refused.state.pile).toHaveLength(2);
    expect(refused.state.currentPlayerId).toBe('p2');

    // Passer non plus : le saut ne fait pas sortir du pli.
    expect(pass(state, 'p2').state.currentPlayerId).toBe('p2');
  });

  it('le joueur menacé qui saute reste dans le pli', () => {
    let state = playingGame({
      p0: ['5H', '3S'],
      p1: ['5S', '4H'],
      p2: ['9D', '6C'],
      p3: ['13C', '7C'],
    });
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;

    const skipped = skip(state, 'p2');
    expect(skipped.events.some((e) => e.type === 'skipped')).toBe(true);
    expect(skipped.state.players.find((p) => p.id === 'p2')!.passed).toBe(false);
    expect(skipped.state.skipThreat).toBe(false);
    expect(skipped.state.currentPlayerId).toBe('p3');

    // p3 reprend la main, et p2 est bien rappelé au tour de table suivant.
    let after = play(skipped.state, 'p3', '13C').state;
    expect(after.currentPlayerId).toBe('p0');
    after = pass(after, 'p0').state;
    after = pass(after, 'p1').state;
    expect(after.currentPlayerId).toBe('p2');
  });

  it('reposer à son tour la même valeur reporte le saut sur le joueur d’après', () => {
    let state = playingGame({
      p0: ['5H', '3S'],
      p1: ['5S', '4H'],
      p2: ['5D', '6C'],
      p3: ['13C', '7C'],
    });
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;
    state = play(state, 'p2', '5D').state;

    expect(state.skipThreat).toBe(true);
    expect(state.currentPlayerId).toBe('p3');
    // p3 n'a pas de 5 : il ne peut que sauter.
    expect(play(state, 'p3', '13C').state.currentPlayerId).toBe('p3');
    expect(skip(state, 'p3').state.currentPlayerId).toBe('p0');
  });

  it('exige une carte seule : une paire ne répond pas à un 5 seul', () => {
    let state = playingGame({
      p0: ['5H', '3S'],
      p1: ['5S', '4H'],
      p2: ['5D', '5C', '6C'],
    });
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;
    expect(state.skipThreat).toBe(true);

    // p2 a deux 5, mais le pli est à une carte : la paire reste interdite.
    expect(play(state, 'p2', '5D', '5C').state.pile).toHaveLength(2);
    expect(play(state, 'p2', '5D').state.currentPlayerId).toBe('p0');
  });

  it('ne concerne pas les paires : on y joue normalement', () => {
    let state = playingGame({
      p0: ['5H', '5S', '3S'],
      p1: ['8D', '8C', '4H'],
      p2: ['13D', '13C', '6C'],
    });
    state = play(state, 'p0', '5H', '5S').state;
    state = play(state, 'p1', '8D', '8C').state;
    expect(state.skipThreat).toBe(false);

    // p2 enchaîne librement : aucun saut ne s'interpose.
    state = play(state, 'p2', '13D', '13C').state;
    expect(state.pile).toHaveLength(3);
    expect(state.currentPlayerId).toBe('p0');
  });

  it('sur une paire reposée à l’identique, c’est le carré qui ferme le pli', () => {
    let state = playingGame({
      p0: ['5H', '5S', '3S'],
      p1: ['5D', '5C', '4H'],
      p2: ['13D', '13C', '6C'],
    });
    state = play(state, 'p0', '5H', '5S').state;
    const result = play(state, 'p1', '5D', '5C');

    // Deux paires de même valeur font quatre cartes : le pli se ferme et p1
    // reprend la main. Aucun saut n'est armé.
    expect(result.events.some((e) => e.type === 'carre')).toBe(true);
    expect(result.state.skipThreat).toBe(false);
    expect(result.state.currentPlayerId).toBe('p1');
  });

  it('le chrono fait sauter le joueur menacé sans le sortir du pli', () => {
    let state = playingGame({
      p0: ['5H', '3S'],
      p1: ['5S', '4H'],
      p2: ['9D', '6C'],
      p3: ['13C', '7C'],
    });
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;

    const expired = tick(state, state.turnDeadline! + 1);
    expect(expired.events.some((e) => e.type === 'skipped')).toBe(true);
    expect(expired.state.players.find((p) => p.id === 'p2')!.passed).toBe(false);
    expect(expired.state.currentPlayerId).toBe('p3');
  });

  it('le saut n’empêche pas de fermer le pli : tous sautent, le dernier reprend', () => {
    let state = playingGame({
      p0: ['5H', '3S'],
      p1: ['5S', '4H'],
      p2: ['9D', '6C'],
    });
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;
    state = skip(state, 'p2').state;
    // Plus personne n'a de 5 : tout le monde passe et p1, dernier poseur,
    // remporte le pli — p2 est bien repassé par la table avant la fermeture.
    state = pass(state, 'p0').state;
    state = pass(state, 'p1').state;
    expect(state.currentPlayerId).toBe('p2');
    state = pass(state, 'p2').state;

    expect(state.pile).toHaveLength(0);
    expect(state.currentPlayerId).toBe('p1');
    expect(state.skipThreat).toBe(false);
  });

  it('réglage désactivé : la valeur égale ne fait plus sauter personne', () => {
    let state = playingGame(
      { p0: ['5H', '3S'], p1: ['5S', '4H'], p2: ['9D', '6C'] },
      { skipOnEqual: false },
    );
    state = play(state, 'p0', '5H').state;
    state = play(state, 'p1', '5S').state;

    expect(state.skipThreat).toBe(false);
    expect(play(state, 'p2', '9D').state.pile).toHaveLength(3);
  });

  it('un saut refusé hors menace ne change rien', () => {
    const state = playingGame({ p0: ['5H', '3S'], p1: ['5S', '4H'], p2: ['9D', '6C'] });
    const result = skip(state, 'p0');
    expect(result.state).toBe(state);
    expect(result.events).toHaveLength(0);
  });
});

describe('fin de manche et classement', () => {
  it('attribue Président, Vice-Président, Vice-Trou et Trou du Cul', () => {
    expect(roleForPosition(0, 4)).toBe('president');
    expect(roleForPosition(1, 4)).toBe('vice_president');
    expect(roleForPosition(2, 4)).toBe('vice_trou');
    expect(roleForPosition(3, 4)).toBe('trou_du_cul');
    expect(roleForPosition(1, 3)).toBe('neutre');
    expect(roleForPosition(2, 3)).toBe('trou_du_cul');
  });

  it('termine la manche quand il ne reste qu’un joueur avec des cartes', () => {
    let state = playingGame({ p0: ['8H'], p1: ['13D'], p2: ['9D', '5C'] });
    state = play(state, 'p0', '8H').state; // p0 termine
    state = play(state, 'p1', '13D').state; // p1 termine → manche finie

    expect(state.phase).toBe('round_end');
    expect(state.finishOrder).toEqual(['p0', 'p1', 'p2']);
    expect(ids(state, 'p0').role).toBe('president');
    expect(ids(state, 'p2').role).toBe('trou_du_cul');
    expect(ids(state, 'p0').score).toBe(3);
    expect(ids(state, 'p2').score).toBe(1);
  });

  it('enchaîne automatiquement sur la manche suivante', () => {
    let state = playingGame({ p0: ['8H'], p1: ['13D'], p2: ['9D', '5C'] });
    state = play(state, 'p0', '8H').state;
    state = play(state, 'p1', '13D').state;
    const next = tick(state, state.phaseEndsAt! + 1).state;
    expect(next.phase).toBe('dealing');
    expect(next.roundNumber).toBe(2);
  });
});

describe('échange de cartes', () => {
  function roundTwoExchange() {
    let state = gameWithPlayers(4);
    state = {
      ...state,
      roundNumber: 1,
      players: state.players.map((p, i) => ({
        ...p,
        role: (['president', 'vice_president', 'vice_trou', 'trou_du_cul'] as const)[i],
      })),
    };
    const dealt = startRound(state, 0).state;
    return tick(dealt, DEAL_MS);
  }

  it('transfère d’office les meilleures cartes du Trou du Cul au Président', () => {
    const { state, events } = roundTwoExchange();
    expect(state.phase).toBe('exchange');
    const auto = events.filter(
      (e) => e.type === 'exchange_transfer' && e.fromId === 'p3' && e.toId === 'p0',
    );
    expect(auto).toHaveLength(1);
    expect(state.players[0].hand.length).toBe(15);
    expect(state.players[3].hand.length).toBe(11);
  });

  it('attend le choix du Président et du Vice-Président puis lance la manche', () => {
    let { state } = roundTwoExchange();
    const president = state.players[0];
    const vice = state.players[1];

    state = reduce(
      state,
      {
        type: 'exchange_give',
        playerId: 'p0',
        cardIds: president.hand.slice(0, 2).map((c) => c.id),
      },
      0,
    ).state;
    expect(state.phase).toBe('exchange');

    state = reduce(
      state,
      { type: 'exchange_give', playerId: 'p1', cardIds: [vice.hand[0].id] },
      0,
    ).state;

    expect(state.phase).toBe('playing');
    expect(state.players.every((p) => p.hand.length === 13)).toBe(true);
    expect(state.currentPlayerId).toBe('p0');
  });

  it('donne automatiquement les cartes les plus faibles si le temps expire', () => {
    const { state } = roundTwoExchange();
    const after = tick(state, state.exchange!.deadline! + 1).state;
    expect(after.phase).toBe('playing');
    expect(after.players.every((p) => p.hand.length === 13)).toBe(true);
  });
});

describe('chrono', () => {
  it('fait passer automatiquement le joueur à l’expiration', () => {
    let state = playingGame({ p0: ['8H', '3S'], p1: ['13D', '4H'], p2: ['9D', '5C'] });
    state = play(state, 'p0', '8H').state;
    const expired = tick(state, state.turnDeadline! + 1);
    expect(expired.events.some((e) => e.type === 'timeout')).toBe(true);
    expect(expired.state.players.find((p) => p.id === 'p1')!.passed).toBe(true);
  });

  it('joue la plus faible combinaison si le joueur a la main', () => {
    const state = playingGame({ p0: ['8H', '3S'], p1: ['13D'], p2: ['9D'] });
    const expired = tick({ ...state, turnDeadline: 10 }, 11).state;
    expect(expired.pile[0].cards[0].id).toBe('3S');
  });
});

describe('confidentialité des mains', () => {
  it('n’expose que la main du destinataire de la vue', () => {
    const state = playingGame({ p0: ['8H', '3S'], p1: ['13D', '4H'], p2: ['9D', '5C'] });
    const view = buildPlayerView(state, 'p1', 0);
    expect(view.hand.map((c) => c.id).sort()).toEqual(['13D', '4H']);
    expect(JSON.stringify(view.players)).not.toContain('8H');
    for (const p of view.players) {
      expect(p).not.toHaveProperty('hand');
      expect(p.cardCount).toBe(2);
    }
  });

  it('ne révèle pas de main à un spectateur', () => {
    const state = playingGame({ p0: ['8H'], p1: ['13D'], p2: ['9D'] });
    const view = buildPlayerView(state, null, 0);
    expect(view.hand).toHaveLength(0);
  });
});

describe('bots', () => {
  it('joue une partie complète à 4 bots sans blocage', () => {
    let state = gameWithPlayers(4);
    state = {
      ...state,
      players: state.players.map((p) => ({ ...p, isBot: true })),
      settings: { ...state.settings, rounds: 2 },
    };
    state = reduce(state, { type: 'start_game', playerId: 'p0' }, 0).state;

    let now = 0;
    for (let i = 0; i < 4000 && state.phase !== 'game_over'; i++) {
      now += 50;
      const botId = state.currentPlayerId;
      const action =
        state.phase === 'playing' && botId ? decideBotAction(state, botId) : null;
      const exchangeAction =
        state.phase === 'exchange'
          ? state.players
              .map((p) => decideBotAction(state, p.id))
              .find((a) => a !== null) ?? null
          : null;
      const chosen = action ?? exchangeAction;
      if (chosen) {
        state = reduce(state, chosen, now).state;
      } else {
        now = Math.max(now, (state.turnDeadline ?? state.phaseEndsAt ?? now) + 1);
        state = tick(state, now).state;
      }
    }

    expect(state.phase).toBe('game_over');
    expect(state.roundNumber).toBe(2);
    const total = state.players.reduce((sum, p) => sum + p.score, 0);
    expect(total).toBe(2 * (4 + 3 + 2 + 1));
  });
});

describe('cas limites', () => {
  it('donne la main au joueur suivant si le gagnant du pli a terminé', () => {
    let state = playingGame({
      p0: ['13H'],
      p1: ['3D', '4H'],
      p2: ['5D', '6C'],
      p3: ['7D', '8C'],
    });
    // p0 pose sa dernière carte : il termine tout en remportant le pli.
    state = play(state, 'p0', '13H').state;
    state = pass(state, 'p1').state;
    state = pass(state, 'p2').state;
    state = pass(state, 'p3').state;

    expect(state.phase).toBe('playing');
    expect(ids(state, 'p0').finishPosition).toBe(0);
    // La main revient au joueur actif suivant, pas au joueur sorti.
    expect(state.currentPlayerId).toBe('p1');
    expect(state.pile).toHaveLength(0);
  });

  it('remporte le pli quand plus personne ne peut répondre', () => {
    let state = playingGame({ p0: ['8H', '9H'], p1: ['3D'], p2: ['4C'] });
    state = play(state, 'p0', '8H').state;
    state = pass(state, 'p1').state;
    state = pass(state, 'p2').state;
    expect(state.currentPlayerId).toBe('p0');
    expect(state.requiredCount).toBeNull();
  });

  it('refuse une combinaison mélangeant deux valeurs', () => {
    const state = playingGame({ p0: ['8H', '9S'], p1: ['3D'], p2: ['4C'] });
    const result = play(state, 'p0', '8H', '9S').state;
    expect(result.pile).toHaveLength(0);
    expect(result.players.find((p) => p.id === 'p0')!.hand).toHaveLength(2);
  });

  it('interdit de rejouer une carte déjà posée', () => {
    let state = playingGame({ p0: ['8H', '9S'], p1: ['13D'], p2: ['14C'] });
    state = play(state, 'p0', '8H').state;
    state = pass(state, 'p1').state;
    state = pass(state, 'p2').state;
    const cheat = play(state, 'p0', '8H').state;
    expect(cheat.pile).toHaveLength(0);
  });

  it('accélère le tour d’un joueur déconnecté', () => {
    let state = playingGame({ p0: ['8H'], p1: ['13D', '3H'], p2: ['14C', '4H'] });
    state = setConnected(state, 'p1', false);
    state = play(state, 'p0', '8H').state;
    expect(state.currentPlayerId).toBe('p1');
    expect(state.turnTotalMs).toBe(DISCONNECTED_TURN_MS);
    expect(state.turnDeadline! - 1000).toBe(DISCONNECTED_TURN_MS);
  });

  it('relance une partie terminée depuis le salon, scores remis à zéro', () => {
    let state = gameWithPlayers(3);
    state = {
      ...state,
      phase: 'game_over',
      roundNumber: 3,
      players: state.players.map((p) => ({ ...p, score: 5, role: 'neutre' as const })),
    };
    const refused = reduce(state, { type: 'restart', playerId: 'p1' }, 0).state;
    expect(refused.phase).toBe('game_over');

    const restarted = reduce(state, { type: 'restart', playerId: 'p0' }, 0).state;
    expect(restarted.phase).toBe('lobby');
    expect(restarted.roundNumber).toBe(0);
    expect(restarted.players.every((p) => p.score === 0 && p.role === null)).toBe(true);
    expect(restarted.mustOpenWithQueenOfSpades).toBe(true);
  });

  it('retire un joueur du salon et transfère le rôle d’hôte', () => {
    let state = gameWithPlayers(4);
    state = removePlayer(state, 'p0');
    expect(state.players).toHaveLength(3);
    expect(state.players[0].isHost).toBe(true);
    expect(state.players.map((p) => p.seat)).toEqual([0, 1, 2]);
  });

  it('joue une partie à 3 et à 8 joueurs sans coup illégal', () => {
    for (const count of [3, 8]) {
      let state = gameWithPlayers(count, count * 7 + 1);
      state = {
        ...state,
        players: state.players.map((p) => ({ ...p, isBot: true })),
        settings: { ...state.settings, rounds: 1 },
      };
      state = reduce(state, { type: 'start_game', playerId: 'p0' }, 0).state;

      let now = 0;
      for (let i = 0; i < 6000 && state.phase !== 'game_over'; i++) {
        now += 40;
        const botId = state.currentPlayerId;
        const action =
          (state.phase === 'playing' && botId ? decideBotAction(state, botId) : null) ??
          (state.phase === 'exchange'
            ? (state.players.map((p) => decideBotAction(state, p.id)).find(Boolean) ?? null)
            : null);
        if (action) state = reduce(state, action, now).state;
        else {
          now = Math.max(now, (state.turnDeadline ?? state.phaseEndsAt ?? now) + 1);
          state = tick(state, now).state;
        }
      }

      expect(state.phase).toBe('game_over');
      expect(state.finishOrder).toHaveLength(count);
      expect(new Set(state.finishOrder).size).toBe(count);
      // La manche s'arrête dès qu'il ne reste qu'un joueur : lui seul peut
      // encore avoir des cartes en main.
      expect(state.players.filter((p) => p.hand.length > 0).length).toBeLessThanOrEqual(1);
    }
  });
});
