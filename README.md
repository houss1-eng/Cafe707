# 707 Café & Resto

Commande à table pour le 707 : les clients commandent depuis leur téléphone, la cuisine et le bar
voient quoi préparer, chaque serveur gère sa terrasse, le gérant voit tout.

## Les espaces

| Espace | Adresse | Pour qui |
|---|---|---|
| Client | `/` | les clients (QR code sur la table) |
| Serveur | `/serveur.html` | chaque serveur, **uniquement sa terrasse** |
| Cuisine / Bar | `/cuisine.html` | tablette en cuisine, tablette au bar |
| Admin | `/admin.html` | le gérant : tout |

**Client** : connexion par code SMS, commande, paiement avec ses points (10 points = 1 DT),
« Appeler le serveur » / « Demander l'addition », suivi en direct (« prête, elle arrive ! »), reçus.

**Serveur** : commandes et appels de sa terrasse, bip à chaque nouveauté, badge « Prête à servir » quand
cuisine + bar ont fini, encaissement espèces ou carte, ticket imprimable, son total encaissé du jour.

**Cuisine / Bar** : chacun ne voit que ce qu'il prépare (la station est réglée par catégorie : Boissons → bar).
Bouton « Prêt ». Carte en rouge après 15 min.

**Admin** :
- Tableau de bord du jour, toutes les commandes.
- Caisse : encaissé par serveur, espèces / carte, clôture de journée.
- Rapports : jour, semaine, mois, période libre, export Excel (CSV).
- Menu : catégories, sous-catégories, produits, photos, options (suppléments, sauces, tailles…), stock, épuisé.
- Terrasses & QR : numéros de table par terrasse, QR codes à imprimer.
- Équipe : serveurs (avec leur terrasse), cuisine, bar, admins.

## Photos des produits

Tant qu'un produit n'a pas de photo, son emoji s'affiche. Pour ajouter les photos (Admin → Menu) :
- **Plusieurs d'un coup** : « 📷 Importer des photos ». Nomme les fichiers comme les produits
  (« Crêpe Nutella.jpg », « cheesecake-fraise.png »…) : ils sont associés tout seuls, tu vérifies, puis « Enregistrer ».
- **Une par une, depuis le téléphone** : appuie sur la vignette d'un produit, l'appareil photo s'ouvre.
- « Sans photo seulement » montre ce qui manque.

Les photos sont réduites automatiquement (800 px) avant l'envoi. Conseil : photos carrées, plat bien éclairé, fond simple.

## Lancer sur ton PC

1. Installer PostgreSQL : `winget install PostgreSQL.PostgreSQL.17`, puis créer la base :
   `& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE cafe707"`
2. Copier `.env.example` en `.env` et mettre le mot de passe PostgreSQL.
3. Puis :

```powershell
npm install
npm run db:seed     # base vide uniquement : menu de départ + comptes (ne touche jamais une base remplie)
npm start           # met la base à jour tout seul (migrations), sans rien effacer
```

En local, sans SMS configuré, le code de connexion s'affiche dans l'app (« Mode test »).

Comptes créés par `npm run db:seed` (**à changer tout de suite** dans Admin → Équipe) :

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| admin | admin707 (ou `ADMIN_PASSWORD`) | admin |
| serveur1 / serveur2 / serveur3 | 707707 | Terrasse 1 / 2 / 3 |
| cuisine | 707707 | écran cuisine |
| bar | 707707 | écran bar |

Test complet de l'API (sur une base fraîchement remplie, serveur lancé) : `BASE=http://localhost:3000 npm test`

## Mettre en ligne (https, toujours allumé)

Le plus simple : **Render** (serveurs à Francfort, https automatique, base PostgreSQL gérée).

1. Mettre le projet sur GitHub (dépôt privé).
2. Sur https://render.com : **New → Blueprint**, choisir le dépôt. `render.yaml` crée le site et la base.
3. Remplir les variables demandées : `PUBLIC_URL` (l'adresse du site), Twilio (SMS), `ADMIN_PASSWORD`.
4. Une fois en ligne, dans l'onglet **Shell** du site : `npm run db:seed` (une seule fois).
5. Admin → Terrasses & QR → imprimer les QR codes et les coller sur les tables.

Coût indicatif : site « Starter » + base « Basic » ≈ 15 à 25 $/mois. Le plan gratuit s'endort et sa base expire :
pas pour un vrai café. Autres options : Railway, Fly.io, ou un VPS avec le `Dockerfile` fourni.

**Sauvegardes** : les bases PostgreSQL payantes de Render sont sauvegardées automatiquement chaque jour
(restauration depuis le tableau de bord Render). Les photos des produits sont dans la base : elles sont sauvegardées avec.

**Nom de domaine** (ex. `commande.707.tn`) : à acheter chez un registrar, puis à ajouter dans Render → Settings → Custom Domain.
Mettre ensuite `PUBLIC_URL` à cette adresse **avant** d'imprimer les QR codes.

## SMS (connexion client)

Twilio : créer un compte, acheter un numéro (ou un « Sender ID » alphanumérique « 707 Cafe » si disponible pour
la Tunisie), puis renseigner `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
Un SMS coûte quelques centimes. Limites intégrées : 1 code par minute et 5 par heure par numéro, 10 par heure par appareil.

## Structure

- `server.js` : démarrage, sécurité (https, en-têtes), routes.
- `routes/` : `menu.js` (public, photos, QR), `client.js`, `staff.js` (serveur, cuisine/bar), `admin.js`.
- `lib/` : `auth.js` (mots de passe, sessions, rôles), `orders.js`, `day.js` (journée de travail), `sms.js`, `http.js`.
- `db/migrations/` : structure de la base, appliquée au démarrage. Toute évolution = un nouveau fichier `002_….sql`.
- `db/seed.sql` + `db/seed.js` : menu et comptes de départ.
- `public/` : les pages (client, serveur, cuisine, admin).
