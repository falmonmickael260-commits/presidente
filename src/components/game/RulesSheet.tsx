'use client';

import { Sheet } from '@/components/ui/Sheet';

const SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: 'Ordre des cartes',
    lines: [
      '3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · Valet · Dame · Roi · As · 2',
      'Le 2 est la carte la plus forte du jeu.',
    ],
  },
  {
    title: 'Combinaisons',
    lines: [
      'On pose 1, 2, 3 ou 4 cartes de même valeur.',
      'Pour jouer sur un pli, il faut le même nombre de cartes et une valeur au moins égale.',
      'Un Roi seul ne bat pas une paire de 8 : le nombre de cartes est imposé.',
    ],
  },
  {
    title: 'Première manche',
    lines: [
      'Le joueur qui possède la Dame de pique ouvre la partie.',
      'Il doit la poser pour lancer le premier pli.',
    ],
  },
  {
    title: 'Passer et fermer un pli',
    lines: [
      'Passer est possible dès qu’une combinaison est sur la table.',
      'Un joueur qui passe ne revient plus dans le pli en cours.',
      'Quand tous les autres ont passé, le dernier à avoir posé remporte le pli et repart avec la combinaison de son choix.',
    ],
  },
  {
    title: 'Même valeur : le suivant saute',
    lines: [
      'Sur une carte seule, reposer exactement la valeur qui est sur la table fait sauter le joueur suivant.',
      'Celui-ci garde une issue : reposer lui aussi cette valeur, et le saut glisse sur le joueur d’après.',
      'S’il ne l’a pas, il saute son tour — mais il reste dans le pli et rejouera au tour suivant.',
      'La règle ne concerne que les cartes seules : sur les paires et les brelans, on joue normalement.',
    ],
  },
  {
    title: 'Carré',
    lines: [
      'Dès que les quatre cartes d’une même valeur sont sur la table, le pli est fermé immédiatement.',
      'Celui qui a posé la quatrième carte reprend la main sur-le-champ.',
    ],
  },
  {
    title: 'Fin de manche',
    lines: [
      '👑 Président · 🥈 Vice-Président · … · 💩 Trou du Cul',
      'Chaque place rapporte des points ; le classement final départage la partie.',
    ],
  },
  {
    title: 'Échange',
    lines: [
      'Le Trou du Cul donne ses 2 meilleures cartes au Président, qui lui rend 2 cartes de son choix.',
      'Le Vice-Trou du Cul donne sa meilleure carte au Vice-Président, qui lui rend 1 carte de son choix.',
    ],
  },
];

export function RulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Règles du Président">
      <div className="flex flex-col gap-5">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="mb-1.5 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-gold-500/85">
              {section.title}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {section.lines.map((line) => (
                <li key={line} className="text-[0.86rem] leading-relaxed text-cream/75">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
