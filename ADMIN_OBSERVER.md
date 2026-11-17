# Revanche Games — spectateur administrateur

Adaptateur additif pour `POST /api/platform/observer`. Il vérifie la signature
serveur `rg-admin-observer-v1`, le jeu destinataire, la date (15 secondes),
l’instance du salon et les identifiants de l’administrateur et de son accès audité.
Il ne crée aucun joueur, ne consomme aucune place et ne reçoit aucune commande
de jeu. La projection ne contient que les informations publiques sélectionnées.

Le panneau central vérifie la session Supabase confirmée, MFA, le rôle courant et
un accès spectateur audité de moins de 30 minutes à chaque interrogation.
`PLATFORM_SHARED_SECRET` reste sur les serveurs. Le navigateur ne contacte pas
cet endpoint avec la clé de signature. Aucun secret de siège ou compte de joueur
n’est nécessaire pour observer.

Déployer cet adaptateur en coordination avec `revanchegames/apps/admin` et ses
migrations du 17 novembre 2026. Pour Kilomax, appliquer également la migration
`20261117000000_admin_public_observer.sql` dans la base de parties existante ;
`GAME_SUPABASE_SERVICE_ROLE_KEY` reste exclusivement côté serveur.

Cette livraison n’ajoute pas la fermeture/exclusion native ni la propagation des
sanctions aux sockets déjà ouvertes. Elle ne doit pas être annoncée comme une
modération native complète. La recette distante avec une vraie partie et le
contrôle de l’absence de modification du nombre de participants restent à faire.
