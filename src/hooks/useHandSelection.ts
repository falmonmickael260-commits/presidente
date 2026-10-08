'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QUEEN_OF_SPADES, comboLabel } from '@/game/cards';
import { canBeat, getCombo, type TableTop } from '@/game/rules';
import type { Card } from '@/game/types';
import type { PlayerView, PublicTransfer } from '@/game/view';
import { haptic } from '@/lib/haptics';
import { sound } from '@/lib/sound';

export interface SelectionCheck {
  valid: boolean;
  text: string | null;
}

export interface HandSelection {
  selected: string[];
  setSelected: (ids: string[]) => void;
  toggle: (cardId: string) => void;
  clear: () => void;
  cards: Card[];
  check: SelectionCheck;
}

/**
 * Sélection de cartes dans la main.
 *
 * La validation est locale et immédiate — pour le confort — mais le serveur
 * revalide systématiquement : elle sert uniquement à guider le joueur.
 */
export function useHandSelection({
  view,
  exchangeMode,
  pendingTransfer,
  tableTop,
  mustPlayQueen,
  skipThreat,
}: {
  view: PlayerView | null;
  exchangeMode: boolean;
  pendingTransfer: PublicTransfer | null;
  tableTop: TableTop | null;
  mustPlayQueen: boolean;
  /** Valeur dominante reposée : seule cette valeur peut encore être jouée. */
  skipThreat: boolean;
}): HandSelection {
  const [selected, setSelected] = useState<string[]>([]);
  const hand = view?.hand ?? [];
  const handById = useMemo(() => new Map(hand.map((card) => [card.id, card])), [hand]);

  // Une sélection ne survit jamais à un changement de tour ou de phase.
  useEffect(() => {
    setSelected([]);
  }, [view?.currentPlayerId, view?.phase, view?.roundNumber]);

  const toggle = useCallback(
    (cardId: string) => {
      const card = handById.get(cardId);
      if (!card) return;
      setSelected((current) => {
        if (current.includes(cardId)) {
          sound().play('deselect');
          haptic('tap');
          return current.filter((id) => id !== cardId);
        }
        sound().play('select');
        haptic('select');

        if (exchangeMode && pendingTransfer) {
          if (current.length >= pendingTransfer.count) return [...current.slice(1), cardId];
          return [...current, cardId];
        }

        // Hors échange, une combinaison ne mélange jamais deux valeurs :
        // choisir une autre valeur repart d'une sélection propre.
        const first = current[0] ? handById.get(current[0]) : undefined;
        if (first && first.rank !== card.rank) return [cardId];
        if (current.length >= 4) return current;
        return [...current, cardId];
      });
    },
    [handById, exchangeMode, pendingTransfer],
  );

  const cards = useMemo(
    () => selected.map((id) => handById.get(id)).filter((card): card is Card => Boolean(card)),
    [selected, handById],
  );

  const check = useMemo<SelectionCheck>(() => {
    if (!view) return { valid: false, text: null };

    if (exchangeMode && pendingTransfer) {
      const need = pendingTransfer.count;
      const plural = need > 1 ? 's' : '';
      if (selected.length === 0) {
        return { valid: false, text: `Choisissez ${need} carte${plural} à donner` };
      }
      if (selected.length === need) {
        return { valid: true, text: `${need} carte${plural} prête${plural} à donner` };
      }
      const left = need - selected.length;
      return { valid: false, text: `Encore ${left} carte${left > 1 ? 's' : ''}` };
    }

    if (cards.length === 0) return { valid: false, text: null };

    const combo = getCombo(cards);
    if (!combo) return { valid: false, text: 'Les cartes doivent être de même valeur' };
    if (tableTop && combo.count !== tableTop.count) {
      return {
        valid: false,
        text: `Il faut poser ${tableTop.count} carte${tableTop.count > 1 ? 's' : ''}`,
      };
    }
    if (skipThreat && tableTop && combo.rank !== tableTop.rank) {
      return {
        valid: false,
        text: `Seul ${comboLabel(tableTop.rank, tableTop.count)} passe — sinon sautez`,
      };
    }
    if (tableTop && !canBeat(combo, tableTop, view.settings.allowEqualRank)) {
      return {
        valid: false,
        text: `Trop faible face à ${comboLabel(tableTop.rank, tableTop.count)}`,
      };
    }
    if (mustPlayQueen && !selected.includes(QUEEN_OF_SPADES)) {
      return { valid: false, text: 'La Dame de pique doit ouvrir la partie' };
    }
    return { valid: true, text: `${comboLabel(combo.rank, combo.count)} — prêt` };
  }, [
    view,
    exchangeMode,
    pendingTransfer,
    selected,
    cards,
    tableTop,
    mustPlayQueen,
    skipThreat,
  ]);

  const clear = useCallback(() => setSelected([]), []);

  return { selected, setSelected, toggle, clear, cards, check };
}
