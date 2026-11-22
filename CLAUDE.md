# Projet : 707 Café & Resto

Application de commande pour le café-restaurant 707 (Sept Cent Sept), Tunisie. Voir README.md.

## Règles métier
- Prix en DT, affichage avec virgule (3,9). Montants calculés en millimes côté serveur.
- Points : 1 point par DT (partie entière du prix unitaire). 10 points = 1 DT de remise (usePoints, multiple de 10,
  plafonné au solde et au montant). Avec remise, points gagnés plafonnés à la partie entière du total payé.
  Annulation : points dépensés rendus, points gagnés retirés, stock rendu.
- Paiement à table : Espèces ou Carte. Le serveur encaisse avec le moyen réel (paid_method, paid_by).
- 3 terrasses (table `floors`, avec table_from/table_to). Le client choisit terrasse + table ; la table doit exister.
- Journée de travail : Africa/Tunis, commence à 5 h (lib/day.js). « Aujourd'hui », caisse et rapports l'utilisent.
- Statuts : nouvelle → en_preparation → servie → payee ; annulee depuis nouvelle/en_preparation.
  ready_at : cuisine + bar ont tout préparé (par ligne : order_items.station / ready_at).

## Espaces et sécurité
- Client (`/`) : connexion par code SMS (otp_codes, lib/sms.js ; devCode renvoyé seulement si SMS_PROVIDER=console hors production).
- Serveur (`/serveur.html`) : uniquement SA terrasse, imposé côté serveur (scopeFloor + canTouchFloor), jamais seulement dans la page.
- Cuisine / Bar (`/cuisine.html`) : rôle cuisine ou bar, voit seulement sa station.
- Admin (`/admin.html`) : tout. Le serveur recalcule toujours prix, points, remise et stock.

## Base de données
- Migrations dans db/migrations (appliquées au démarrage, verrou advisory). Ne jamais modifier une migration
  déjà appliquée en production : ajouter 002_xxx.sql.
- `npm run db:seed` ne fait rien si le menu existe déjà.
- Photos dans la table images (bytea), servies par /api/images/:id.

## Style : d'après la maquette « café » fournie par le gérant
- Crème #f7efe5, brun espresso #2a1b12, caramel #d6a35c. Police Poppins. Cartes arrondies, icônes SVG au trait
  (symboles <symbol id="i-…"> dans index.html, helper ic(name) dans app.js). Pas d'emoji.
- Accueil : partie haute foncée (salut, « Qu'est-ce qui te ferait plaisir ? », recherche + bouton caramel),
  tuiles « Catégories » avec photo, « Recommandé pour toi » en cartes, puis chaque catégorie en liste (photo à gauche).
- Barre de navigation en bas : Accueil, Menu, Panier (badge), Commandes, Compte. Bandeau « Voir le panier » flottant.
- Fiche produit : grande photo, choix uniques en pastilles, suppléments en liste, « Ajouter au panier ».
  Le + ajoute directement un produit sans options ; toucher la photo ou le nom ouvre la fiche.
- Suivi de commande par étapes (Reçue, Préparation, Prête, Servie). Compte : carte foncée + fidélité.
- Photos de départ : db/photos/<id>.jpg (Wikimedia Commons, licences libres, auteurs dans credits.json,
  affichés via « Crédits photos » → /api/credits). `npm run photos` les ajoute aux produits sans photo.
- Fichiers CSS/JS appelés avec ?v=N dans les pages HTML : augmenter N à chaque modification.

## Tests
- `BASE=http://localhost:3000 npm test` (scripts/smoke-test.js) sur une base fraîchement remplie.

## Reste à faire
- Compose ta salade. Photos des produits à ajouter dans l'admin.
- App en arabe / derja. « Pour toi » personnalisé.
