'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { cardLabel } from '@/game/cards';
import type { Card } from '@/game/types';
import { PlayingCard } from '@/components/card/PlayingCard';
import { CARD_RATIO } from '@/components/card/geometry';
import { anchorKeys, useAnchors } from './Anchors';

interface HandFanProps {
  cards: Card[];
  selectedIds: string[];
  playableIds: string[];
  onToggle: (cardId: string) => void;
  /** Largeur disponible, en pixels. */
  width: number;
  compact: boolean;
  interactive: boolean;
  /** Décalage entre deux cartes à la distribution, en secondes. */
  dealStagger: number;
  /** Décalage d'où partent les cartes lors de la distribution. */
  dealOrigin: { dx: number; dy: number };
  reducedMotion: boolean;
}

interface Slot {
  card: Card;
  x: number;
  y: number;
  rotate: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Main du joueur en éventail.
 *
 * La largeur des cartes s'adapte à l'espace disponible sans jamais descendre
 * sous un seuil de lisibilité : au-delà, c'est le chevauchement qui augmente.
 */
export function useFanLayout(cards: Card[], width: number, compact: boolean) {
  return useMemo(() => {
    const count = cards.length;
    const maxCard = compact ? 96 : 112;
    const minCard = compact ? 52 : 68;
    const padding = compact ? 16 : 30;
    const usable = Math.max(180, width - padding);

    // Angle total de l'éventail borné : au-delà, les cartes des extrémités
    // balaient trop de largeur et finiraient rognées par le bord de l'écran.
    const angleStep = clamp(Math.min(4.6, 30 / Math.max(1, count - 1)), 1.2, 4.6);
    const maxAngle = (angleStep * Math.max(0, count - 1)) / 2;
    const rad = (maxAngle * Math.PI) / 180;

    // Largeur réellement balayée, rotation comprise :
    //   extent(w) = w · [ 1 + (n-1)·ov + 2·sin(a)/ratio − (1 − cos(a)) ]
    const sweep = (2 * Math.sin(rad)) / CARD_RATIO - (1 - Math.cos(rad));
    const target = compact ? 0.34 : 0.44;

    let overlap = target;
    let cardWidth =
      count > 1 ? usable / (1 + (count - 1) * target + sweep) : Math.min(maxCard, usable);
    cardWidth = Math.min(maxCard, cardWidth);

    if (cardWidth < minCard) cardWidth = minCard;
    if (count > 1) {
      overlap = clamp((usable / cardWidth - sweep - 1) / (count - 1), 0.12, 0.5);
    }

    const step = cardWidth * overlap;
    const totalWidth = cardWidth + step * Math.max(0, count - 1);
    const lift = clamp(count * 1.1, 4, 20);
    // Une carte pivotée autour de son bord bas déborde vers le bas : on réserve
    // exactement la place nécessaire pour qu'aucune carte ne soit rognée.
    const bottomInset = (cardWidth / 2) * Math.sin(rad) + lift + 12;

    const slots: Slot[] = cards.map((card, index) => {
      const centered = index - (count - 1) / 2;
      const normalized = count > 1 ? centered / ((count - 1) / 2) : 0;
      return {
        card,
        x: -totalWidth / 2 + cardWidth / 2 + index * step,
        y: normalized * normalized * lift,
        rotate: centered * angleStep,
      };
    });

    const cardHeight = cardWidth / CARD_RATIO;
    // Marge haute pour la carte soulevée (survol ou sélection).
    const topRoom = cardHeight * 0.26;
    return {
      slots,
      cardWidth,
      cardHeight,
      totalWidth,
      lift,
      bottomInset,
      step,
      height: cardHeight + bottomInset + topRoom,
    };
  }, [cards, width, compact]);
}

export function HandFan({
  cards,
  selectedIds,
  playableIds,
  onToggle,
  width,
  compact,
  interactive,
  dealStagger,
  dealOrigin,
  reducedMotion,
}: HandFanProps) {
  const { bind } = useAnchors();
  const { slots, cardWidth, cardHeight, bottomInset, height, step } = useFanLayout(
    cards,
    width,
    compact,
  );
  const playable = useMemo(() => new Set(playableIds), [playableIds]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedIndexes = useMemo(
    () =>
      slots
        .map((slot, index) => (selected.has(slot.card.id) ? index : -1))
        .filter((index) => index >= 0),
    [slots, selected],
  );

  const stagger = reducedMotion ? 0 : dealStagger;

  return (
    <div
      ref={bind(anchorKeys.hand)}
      className="stage-3d relative mx-auto"
      style={{ width: '100%', height }}
      role="group"
      aria-label="Votre main"
    >
      {slots.map((slot, index) => {
        const isSelected = selected.has(slot.card.id);
        const isPlayable = playable.has(slot.card.id);
        // Les cartes voisines s'écartent légèrement de la carte soulevée.
        const neighbourPush = selectedIndexes.reduce((sum, selectedIndex) => {
          if (selectedIndex === index) return sum;
          const distance = index - selectedIndex;
          if (Math.abs(distance) > 2) return sum;
          return sum + (Math.sign(distance) * (cardWidth * 0.1)) / Math.abs(distance);
        }, 0);

        // Les cartes se chevauchent : celle du dessus (index supérieur, ou
        // sélectionnée) capte les clics sur toute sa largeur, mais celle du
        // dessous ne doit être cliquable que sur sa partie réellement visible
        // — sinon un tap vise une carte et en sélectionne une autre, au
        // toucher comme à la souris dans la zone de recouvrement.
        const isLast = index === slots.length - 1;
        const hitWidth = isSelected || isLast ? cardWidth : step;

        return (
          <motion.button
            key={slot.card.id}
            ref={bind(anchorKeys.card(slot.card.id))}
            type="button"
            disabled={!interactive}
            aria-pressed={isSelected}
            aria-label={`${cardLabel(slot.card)}${isSelected ? ', sélectionnée' : ''}${
              interactive && !isPlayable ? ', non jouable' : ''
            }`}
            onClick={() => onToggle(slot.card.id)}
            className="absolute left-1/2 top-auto origin-bottom will-animate no-select disabled:cursor-default"
            style={{
              width: hitWidth,
              height: cardHeight,
              bottom: bottomInset,
              marginLeft: -cardWidth / 2,
              zIndex: isSelected ? 200 + index : index,
              borderRadius: '7%',
            }}
            initial={false}
            animate={{
              x: slot.x + neighbourPush,
              y: slot.y - (isSelected ? cardHeight * 0.26 : 0),
              rotate: slot.rotate * (isSelected ? 0.25 : 1),
              scale: isSelected ? 1.07 : 1,
            }}
            transition={
              reducedMotion
                ? { duration: 0.14 }
                : { type: 'spring', stiffness: 360, damping: 28, mass: 0.7 }
            }
            whileHover={
              interactive && !isSelected
                ? {
                    y: slot.y - cardHeight * 0.12,
                    transition: { type: 'spring', stiffness: 460, damping: 26 },
                  }
                : undefined
            }
            whileTap={interactive ? { scale: isSelected ? 1.03 : 0.98 } : undefined}
          >
            {/* Couche d'arrivée : la carte vient de la pioche à la distribution.
                Séparée de la couche de placement pour que le délai de
                distribution ne retarde jamais la réaction à la sélection. */}
            <motion.div
              className="absolute left-0 top-0 will-animate"
              style={{ width: cardWidth, height: cardHeight }}
              initial={
                reducedMotion
                  ? { opacity: 0 }
                  : {
                      x: dealOrigin.dx - slot.x,
                      y: dealOrigin.dy,
                      rotate: -16,
                      scale: 0.66,
                      opacity: 0,
                    }
              }
              animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }}
              transition={
                reducedMotion
                  ? { duration: 0.2, delay: index * 0.01 }
                  : {
                      type: 'spring',
                      stiffness: 320,
                      damping: 26,
                      mass: 0.8,
                      delay: index * stagger,
                    }
              }
            >
              <PlayingCard
                card={slot.card}
                width={cardWidth}
                dimmed={interactive && !isPlayable && !isSelected}
                elevation={isSelected ? 'lift' : 'rest'}
              />
              {isSelected && (
                <span
                  className="pointer-events-none absolute -inset-[2px] rounded-[8.5%] ring-[2.5px] ring-gold-300"
                  style={{
                    boxShadow:
                      '0 0 0 1px rgba(10,20,14,0.55), 0 0 26px 2px rgba(236,208,138,0.55)',
                  }}
                />
              )}
            </motion.div>
          </motion.button>
        );
      })}
    </div>
  );
}
