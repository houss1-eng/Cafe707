# Projet : 707 Café & Resto

Application de commande pour le café-restaurant 707 (Sept Cent Sept), Tunisie. Voir README.md.

## Règles métier
- Prix en DT, affichage avec virgule (3,9). Montants calculés en millimes côté serveur.
- Points : 1 point par DT (partie entière du prix unitaire). 10 points = 1 DT de remise (usePoints, multiple de 10,
  plafonné au solde et au montant). Avec remise, points gagnés plafonnés à la partie entière du total payé.
  Annulation : points dépensés rendus, points gagnés retirés, stock rendu.
- Paiement à table : le client ne choisit rien. Le serveur note Espèces ou Carte à l'encaissement (paid_method, paid_by).
- 3 terrasses (table `floors`, avec table_from/table_to). La table vient uniquement du QR code (?etage=1&table=4) :
  le client ne choisit rien. Bouton « Scanner » = caméra dans l'app (public/scanner.js, BarcodeDetector ou public/vendor/jsQR.js ;
  https obligatoire pour la caméra). Un scan vaut pour UNE commande envoyée dans les 10 min (SCAN_FRESH), sinon la caméra s'ouvre à l'envoi ; la table de la dernière commande reste 4 h pour appeler le serveur ou l'addition.
- Journée de travail : Africa/Tunis, commence à 5 h (lib/day.js). « Aujourd'hui », caisse et rapports l'utilisent.
- Statuts : nouvelle → en_preparation → servie → payee ; annulee depuis nouvelle/en_preparation.
  ready_at : cuisine + bar ont tout préparé (par ligne : order_items.station / ready_at).

- Bouton admin Dispo / Non dispo (table settings) : fermé = commandes et appels serveur refusés côté serveur ;
  l'addition reste possible pour les clients encore à table. Les commandes déjà envoyées continuent normalement.

- Terrains de foot (707 Club, 3 terrains, table pitches, créneaux d'1 h, 9 h-00 h, 30 jours) : le client demande un créneau,
  le chef de terrain l'appelle puis confirme. Le créneau ne s'éteint qu'une fois confirmé (index unique) ; les autres demandes
  sur cette heure sont refusées automatiquement. Prix par terrain et par heure fixé par l'admin (pitches.price_mil),
  copié dans la réservation à la demande : un nouveau tarif ne change pas les réservations existantes.
  Seul le chef de terrain (rôle terrain) peut annuler un match : ni le client, ni l'admin (imposé côté serveur). Indépendant du bouton Dispo / Non dispo du café.

- Notifications Web Push (lib/push.js, public/push.js, public/sw.js, table push_subscriptions) : arrivent même app fermée.
  Clés VAPID créées automatiquement dans settings (ou VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Envois attendus avant la réponse
  (Vercel), une erreur d'envoi ne bloque jamais l'action. Client : étapes de commande et de réservation. Serveur : commandes,
  appels et « prête » de SA terrasse. Cuisine / bar : leurs lignes. Chef de terrain : nouvelles demandes. Admin : rien.
  iPhone : seulement depuis l'icône sur l'écran d'accueil (iOS 16.4+).

## Espaces et sécurité
- Client (`/`) : pas de SMS. Numéro + code personnel à 6 chiffres (clients.pin_hash), montré une seule fois à la création, en notification
  si autorisée. 5 erreurs bloquent le numéro 15 min. Code oublié : Admin → Clients. Le numéro n'est pas vérifié automatiquement.
- Serveur (`/serveur.html`) : uniquement SA terrasse, imposé côté serveur (scopeFloor + canTouchFloor), jamais seulement dans la page.
- Cuisine / Bar (`/cuisine.html`) : rôle cuisine ou bar, voit seulement sa station.
- Chef de terrain (`/terrain.html`) : réservations et numéros des clients (rôle terrain ou admin).
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

## Vercel
- server.js exporte app ; si VERCEL est défini, pas de listen ni de migration au démarrage (npm run db:migrate avec l'adresse directe Neon).
- DATABASE_URL en ligne = adresse « pooled » Neon. Pas d'état en mémoire ni de setInterval côté serveur : limites dans rate_limits.
- express.static est ignoré sur Vercel : les fichiers de public/ passent par son CDN, en-têtes dans vercel.json.

## Tests
- `BASE=http://localhost:3000 npm test` (scripts/smoke-test.js) sur une base fraîchement remplie.

## Reste à faire
- Compose ta salade. Photos des produits à ajouter dans l'admin.
- App en arabe / derja. « Pour toi » personnalisé.
