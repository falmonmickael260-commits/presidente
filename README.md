# 🃏 Le Président — jeu de cartes multijoueur en temps réel

Une véritable table de jeu numérique pour le **Président** : 3 à 8 joueurs, serveur
autoritaire, cartes entièrement vectorielles et motion design soigné.

Aucun compte, aucune installation côté joueur : on crée une salle, on partage un
code de 4 caractères, et on joue.

---

## Démarrer

```bash
npm install
npm run dev          # http://localhost:3000
```

Rien d'autre à configurer. Le serveur Next.js héberge l'état des parties en
mémoire et diffuse les mises à jour en temps réel.

```bash
npm run verify       # typecheck + tests + build
npm run test         # moteur de règles (Vitest)
npm run build && npm start
```

### Jouer seul pour essayer

Depuis le salon, l'hôte peut **ajouter des bots** : il suffit de trois joueurs
(humains ou bots) pour lancer une partie complète.

---

## Règles implémentées

| Sujet | Règle |
| --- | --- |
| Joueurs | 3 à 8 |
| Paquet | 52 cartes, sans joker, distribuées aussi équitablement que possible |
| Ordre | 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · V · D · R · A · **2** (le 2 est la plus forte) |
| Combinaisons | 1, 2, 3 ou 4 cartes **de même valeur** |
| Supériorité | même nombre de cartes, valeur au moins égale |
| Ouverture | manche 1 : le porteur de la **Dame de pique** commence et doit la poser |
| Passer | définitif pour le pli en cours |
| Fermeture | quand tous les autres ont passé, le dernier poseur reprend la main **avec la combinaison de son choix** |
| Saut | sur une **carte seule**, reposer la valeur de la table fait sauter le joueur suivant — sauf s'il repose lui aussi cette valeur, et le saut glisse d'un cran. Sauter ne sort pas du pli. Les paires et brelans ne sont pas concernés |
| Carré | dès que les 4 cartes d'une valeur sont sur la table, le pli est fermé immédiatement et le poseur de la 4ᵉ reprend la main |
| Classement | 👑 Président · 🥈 Vice-Président · … · 💩 Trou du Cul |
| Échange | Trou du Cul → Président : 2 meilleures cartes, retour de 2 cartes au choix. Vice-Trou → Vice-Président : 1 meilleure carte, retour de 1 carte au choix |

### Choix d'interprétation assumés

Le cahier des charges décrit la fermeture d'un pli par carré avec la séquence
`5 → 5 → 5 → 5`, ce qui suppose de pouvoir reposer **la même valeur**. Le
contre-exemple de la règle de supériorité (« un Roi ne bat pas une paire de 8 »)
porte lui sur le *nombre* de cartes, pas sur l'égalité de valeur.

Le jeu autorise donc par défaut la valeur égale, et **l'hôte peut exiger une
valeur strictement supérieure** depuis les réglages du salon. Les carrés
cumulés ne sont alors possibles qu'en posant les quatre cartes d'un coup.

Deux points que le cahier des charges ne tranche pas :

- **Qui ouvre les manches suivantes** : le Président (récompense lisible).
- **Score** : chaque place rapporte `nombre de joueurs − position` points ; le
  classement final de la partie additionne les manches.

---

## Architecture

```
src/
├─ game/            Moteur pur — aucune dépendance React, réseau ou DOM
│  ├─ cards.ts      Paquet, valeurs, tri, distribution
│  ├─ rules.ts      Combinaisons, supériorité, validation centrale des coups
│  ├─ engine.ts     Machine d'état (lobby → distribution → échange → jeu → fin)
│  ├─ view.ts       Projection par joueur (redaction des mains adverses)
│  ├─ bot.ts        Stratégie des bots
│  └─ *.test.ts     37 tests unitaires
├─ server/          État des salles, diffusion SSE, chrono, persistance optionnelle
├─ app/api/         Routes REST + flux temps réel
├─ components/
│  ├─ card/         Cartes SVG (enseignes, figures, dos, dos allégé)
│  ├─ game/         Table, sièges, pli, éventail, couche de vol, overlays
│  ├─ lobby/ home/ room/
│  └─ ui/
├─ hooks/
│  ├─ useRoom       Connexion temps réel et reprise après coupure
│  ├─ useDirector   Événements serveur → trajectoires, sons et moments
│  └─ useHandSelection  Sélection de cartes et validation immédiate
└─ lib/             Audio procédural, haptique, session locale
```

### Machine d'état

```
LOBBY → DISTRIBUTION → [ÉCHANGE] → TOUR ⇄ PLI → PLI FERMÉ
                                      ↓
                       JOUEUR TERMINE → FIN DE MANCHE → NOUVELLE MANCHE
                                                      ↓
                                               PARTIE TERMINÉE
```

La logique métier vit entièrement dans `src/game/`. L'interface ne fait
qu'afficher et animer : elle ne décide jamais d'un coup.

### Le serveur fait autorité

- Chaque action est **revalidée** côté serveur (`validatePlay` / `validatePass`),
  quel que soit ce que prétend le client.
- Un joueur ne reçoit que **sa propre main**. Les autres joueurs sont réduits à
  `{ pseudo, avatar, nombre de cartes, statut }` — voir `src/game/view.ts`.
- Le chrono de tour tourne côté serveur : à l'expiration, l'action par défaut
  (passer, ou poser la plus faible combinaison) est appliquée par le serveur.
- L'identité tient dans un jeton opaque échangé à l'inscription ; il n'accorde
  aucun droit en lui-même, il ne fait qu'identifier.

### Temps réel

Le flux passe par **SSE** (`/api/rooms/[code]/stream`). À chaque mutation, le
serveur pousse à chaque abonné une vue personnalisée plus la liste des
événements à animer.

Ce choix est délibéré : chaque joueur doit recevoir un état **différent**.
Diffuser les lignes brutes d'une table (via Supabase Realtime par exemple)
exposerait les mains adverses à tous les abonnés du canal.

La reconnexion est triviale : le client garde son jeton en `localStorage`,
`EventSource` se reconnecte avec un repli exponentiel, et la première vue reçue
fait autorité. Rafraîchir la page, changer de réseau ou mettre le téléphone en
veille ne fait pas perdre la partie.

Un joueur qui ferme l'onglet est marqué hors ligne et son tour expire en 6 s au
lieu de 30 : une déconnexion n'immobilise jamais la table. Un départ explicite
libère la place immédiatement tant que la partie n'a pas commencé.

### Supabase (optionnel)

Le jeu fonctionne sans Supabase. En configurant les variables ci-dessous, les
salles sont persistées et survivent à un redémarrage du serveur :

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Appliquez alors `supabase/schema.sql`. La table `rooms` reste inaccessible
depuis le navigateur (RLS sans policy publique) : elle contient les mains.

---

## Qualité visuelle

- **Aucun asset bitmap.** Cartes, enseignes, figures et dos sont des SVG
  paramétriques : elles restent nettes sur mobile, Retina, 2K et 4K, à toute
  échelle et pendant les animations.
- Le grain du tapis est généré par `feTurbulence`, pas par une image.
- Les figures (V / D / R) utilisent une composition héraldique plutôt qu'un
  personnage détaillé : à 55 px de large dans une main éventaillée, un visage
  dessiné devient illisible alors qu'un monogramme reste parfaitement lisible.
- L'éventail calcule la largeur réellement balayée par les cartes inclinées :
  aucune carte n'est jamais rognée, de 320 px à 4K.

## Motion design

Chaque animation sert la lisibilité du jeu :

- **Distribution** : les cartes partent du centre, une par une, vers chaque joueur.
- **Pose** : la carte quitte la main, accélère, suit un arc, tourne, ralentit,
  touche la table, rebondit légèrement puis se stabilise — trois couches
  imbriquées (horizontale décélérée, verticale en arc, rotation + impact).
- **Pli** : chaque pose reçoit un décalage et une rotation propres, déterministes,
  qui créent une vraie pile.
- **Carré** : impact, onde de choc, éclat, particules, puis fermeture du pli.
- **Fin de manche** : les joueurs apparaissent dans leur ordre d'arrivée.

Les cartes en vol atterrissent **exactement** à la position que le pli leur
réserve : aucune carte ne saute au moment de son intégration.

C'est le client qui décide quand les cartes quittent la table, pas le serveur.
Le moteur ferme un pli dès la quatrième carte d'un carré posée ; sans cette
séparation, les quatre cartes disparaîtraient avant même d'avoir atterri.

`prefers-reduced-motion` est respecté : les trajectoires sont remplacées par des
fondus courts, sans jamais désactiver de fonctionnalité.

## Accessibilité

- Chaque carte est un bouton avec un libellé lisible (« dame de pique,
  sélectionnée »).
- Raccourcis clavier : `Entrée` pour jouer, `P` pour passer, `Échap` pour
  annuler la sélection.
- Les états ne reposent jamais uniquement sur la couleur (chrono : anneau +
  pulsation ; passe : pastille texte).
- Contrastes renforcés sous `prefers-contrast: more`.

## Performance

Toutes les animations portent sur `transform` et `opacity`. Le chrono s'écrit
directement dans le DOM en `requestAnimationFrame` : aucun rendu React par frame.

---

## Déploiement

Voir [DEPLOY.md](DEPLOY.md). En résumé : le serveur doit tourner en **un seul
processus persistant** (Render, Fly.io, Railway, Docker) — les plateformes
serverless ne conviennent pas à l'état en mémoire et aux flux SSE.

## Licence

Projet privé.
