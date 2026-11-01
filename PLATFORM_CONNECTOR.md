# Revanche Games : connecteur des invitations

Source commune : dépôt `revanchegames`, dossier `vendor/game-connector`.

`POST /api/platform/connector` accepte uniquement des commandes serveur signées,
avec audience de jeu et timestamp, pour vérifier un siège et admettre un ami.
`POST /api/platform/context` produit un contexte chiffré court à partir de la
preuve du siège, pour ouvrir le sélecteur d’amis dans la plateforme.

`PLATFORM_SHARED_SECRET` reste côté serveur et doit correspondre à celui de la
plateforme. Aucun secret serveur n’est inclus dans les messages navigateur.
Le pont vérifie l’origine exacte et la fenêtre source. Les protocoles natifs,
les codes manuels et les règles des jeux restent présents.

Voir `docs/INVITATIONS_DIRECTES.md` dans le dépôt plateforme pour la recette,
les migrations centrales, les commandes de synchronisation et les limites.
