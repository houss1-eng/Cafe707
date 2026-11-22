-- Données de départ (prix et kcal = valeurs de test). Lancé par `npm run db:seed` sur une base vide.

-- Les 3 terrasses du café (noms à adapter)
INSERT INTO floors (id, name, table_from, table_to, position) VALUES
  (1, 'Terrasse 1', 1, 15, 0),
  (2, 'Terrasse 2', 16, 30, 1),
  (3, 'Terrasse 3', 31, 45, 2);
SELECT setval('floors_id_seq', 3);

-- « Pour toi » n'est pas une catégorie : c'est l'onglet des favoris, ajouté par l'app.
INSERT INTO categories (key, label, title, station, position) VALUES
  ('boissons', 'Boissons', 'Boissons', 'bar', 1),
  ('salades', 'Salades', 'Salades', 'cuisine', 2),
  ('crepes', 'Crêpes', 'Crêpes', 'cuisine', 3),
  ('desserts', 'Desserts', 'Desserts', 'cuisine', 4),
  ('pizzas', 'Pizzas', 'Pizzas', 'cuisine', 5),
  ('petitdej', 'Petit-déj', 'Petit-déj', 'cuisine', 6);

INSERT INTO subcategories (category_key, name, position) VALUES
  ('boissons', 'Cafés', 0), ('boissons', 'Capsules', 1), ('boissons', 'Thés & infusions', 2),
  ('boissons', 'Boissons froides', 3), ('boissons', 'Smoothies', 4), ('boissons', 'Mojitos', 5),
  ('boissons', 'Jus du jour', 6),
  ('crepes', 'Crêpes salées', 0), ('crepes', 'Crêpes sucrées', 1),
  ('desserts', 'Cheesecakes', 0), ('desserts', 'Sweet signatures', 1);

INSERT INTO products (id, name, price, kcal, category_key, subcategory, kind, icon, note, badge, favorite, sold_out, position) VALUES
  (1,  'Express', 3.9, 10, 'boissons', 'Cafés', 'simple', '☕', 'Espresso serré', 'Best-seller', TRUE, FALSE, 1),
  (14, 'Cappuccino', 7.8, 150, 'boissons', 'Cafés', 'simple', '☕', 'Mousse de lait onctueuse', NULL, FALSE, FALSE, 2),
  (15, 'Américain', 4.2, 10, 'boissons', 'Cafés', 'simple', '☕', 'Allongé, doux et aromatique', NULL, FALSE, FALSE, 3),
  (16, 'Latte', 4.9, 150, 'boissons', 'Cafés', 'simple', '🥛', 'Espresso et lait chaud', 'Top 5 de la semaine', FALSE, FALSE, 4),
  (17, 'Chocolat au lait', 5.2, 210, 'boissons', 'Cafés', 'simple', '🍫', 'Chocolat chaud, doux', NULL, FALSE, FALSE, 5),
  (18, 'Express Nespresso', 6.5, 5, 'boissons', 'Capsules', 'simple', '☕', 'Capsule de ton choix', NULL, FALSE, FALSE, 6),
  (19, 'Latte Nespresso', 7.0, 140, 'boissons', 'Capsules', 'simple', '🥛', 'Onctueux, mousse de lait', NULL, FALSE, FALSE, 7),
  (20, 'Thé vert Kyufi', 5.4, 5, 'boissons', 'Thés & infusions', 'simple', '🍵', 'Léger et parfumé', 'Best-seller', FALSE, FALSE, 8),
  (21, 'Infusion', 5.4, 5, 'boissons', 'Thés & infusions', 'simple', '🌼', 'Infusion douce, sans théine', NULL, FALSE, FALSE, 9),
  (22, 'Iced coffee', 7.9, 120, 'boissons', 'Boissons froides', 'simple', '🧊', 'Café et lait frais sur glaçons', NULL, FALSE, FALSE, 10),
  (23, 'Iced coffee Caramel', 9.5, 190, 'boissons', 'Boissons froides', 'simple', '🧊', 'Caramel maison', 'Best-seller', FALSE, FALSE, 11),
  (24, 'Iced coffee Cannelle', 9.5, 190, 'boissons', 'Boissons froides', 'simple', '🧊', 'Cannelle', NULL, FALSE, TRUE, 12),
  (25, 'Frappuccino classique', 11.9, 320, 'boissons', 'Boissons froides', 'simple', '🥤', 'Café mixé, lait et chantilly', NULL, FALSE, FALSE, 13),
  (26, 'Frappuccino Nutella', 14.9, 480, 'boissons', 'Boissons froides', 'simple', '🥤', 'Nutella et chantilly', 'Signature', FALSE, FALSE, 14),
  (27, 'Eau minérale 1 L', 3.0, 0, 'boissons', 'Boissons froides', 'simple', '💧', 'Bouteille 1 L', NULL, TRUE, FALSE, 15),
  (28, 'Coca-Cola', 4.4, 140, 'boissons', 'Boissons froides', 'simple', '🥤', '33 cl', NULL, TRUE, FALSE, 16),
  (29, 'Smoothie Fruit de la passion', 13.9, 260, 'boissons', 'Smoothies', 'simple', '🥭', 'Passion fraîche', NULL, FALSE, FALSE, 17),
  (30, 'Piña colada', 13.9, 340, 'boissons', 'Smoothies', 'simple', '🍍', 'Ananas et coco, sans alcool', 'Signature', FALSE, FALSE, 18),
  (31, 'Mojito Virgin', 12.4, 130, 'boissons', 'Mojitos', 'simple', '🍹', 'Menthe, citron vert, sans alcool', 'Best-seller', FALSE, FALSE, 19),
  (3,  'Chicha Menthe', 9.0, 0, 'boissons', 'Mojitos', 'simple', '🌿', 'Menthe fraîche', NULL, TRUE, FALSE, 20),
  (32, 'Citronnade', 6.4, 140, 'boissons', 'Jus du jour', 'simple', '🍋', 'Citron frais et acidulé', 'Best-seller', FALSE, FALSE, 21),
  (33, 'Orange pressée', 8.4, 140, 'boissons', 'Jus du jour', 'simple', '🍊', 'Pressée à la minute', NULL, FALSE, FALSE, 22),
  (34, 'Pomme pressée', 6.9, 160, 'boissons', 'Jus du jour', 'simple', '🍏', 'Pomme fraîche', NULL, FALSE, TRUE, 23),
  (35, 'Crêpe thon fromage', 14.9, 540, 'crepes', 'Crêpes salées', 'simple', '🥞', 'Thon, fromage fondant', 'Nouveau', FALSE, FALSE, 24),
  (36, 'Crêpe viande hachée', 18.9, 670, 'crepes', 'Crêpes salées', 'simple', '🥞', 'Viande hachée, poivrons', 'Nouveau', FALSE, FALSE, 25),
  (6,  'Crêpe Nutella', 13.9, 520, 'crepes', 'Crêpes sucrées', 'simple', '🥞', 'Chocolat noisette', NULL, TRUE, FALSE, 26),
  (37, 'Crêpe Nutella caramel salé', 14.9, 560, 'crepes', 'Crêpes sucrées', 'simple', '🥞', 'Nutella et caramel au beurre salé', 'Nouveau', FALSE, FALSE, 27),
  (38, 'Cheesecake Fraise', 16.9, 430, 'desserts', 'Cheesecakes', 'simple', '🍰', 'Coulis de fraise', 'Nouveau', FALSE, FALSE, 28),
  (39, 'Cheesecake Caramel beurre salé', 16.9, 500, 'desserts', 'Cheesecakes', 'simple', '🍰', 'Caramel, biscuit croustillant', 'Top 5 de la semaine', FALSE, FALSE, 29),
  (40, 'Cheesecake Fruits rouges', 16.9, 450, 'desserts', 'Cheesecakes', 'simple', '🍰', 'Coulis de fruits rouges', NULL, FALSE, FALSE, 30),
  (41, 'Cheesecake Citron', 16.9, 420, 'desserts', 'Cheesecakes', 'simple', '🍋', 'Citron', NULL, FALSE, TRUE, 31),
  (7,  'Salade césar', 14.5, 380, 'salades', '', 'simple', '🥗', 'Poulet, parmesan', NULL, FALSE, FALSE, 32),
  (8,  'Pizza', 12.0, 700, 'pizzas', '', 'pizza', '🍕', 'Pâte, base à choisir', NULL, TRUE, FALSE, 33),
  (10, 'Café au lait', 4.0, 60, 'petitdej', '', 'simple', '☕', 'Lait chaud', NULL, FALSE, FALSE, 34),
  (11, 'Jus d''orange', 5.5, 110, 'petitdej', '', 'simple', '🍊', 'Pressé', NULL, FALSE, FALSE, 35),
  (12, 'Croissant', 2.5, 230, 'petitdej', '', 'simple', '🥐', 'Beurre', NULL, FALSE, FALSE, 36),
  (13, 'Omelette', 6.0, 250, 'petitdej', '', 'simple', '🍳', 'Deux œufs', NULL, FALSE, FALSE, 37);

-- Pizza : sauces et suppléments
INSERT INTO option_groups (id, product_id, title, single, position) VALUES
  (1, 8, 'Sauce', TRUE, 0),
  (2, 8, 'Suppléments', FALSE, 1);
SELECT setval('option_groups_id_seq', 2);

INSERT INTO options (id, group_id, name, price, kcal, position) VALUES
  ('s-tomate', 1, 'Sauce tomate', 0.5, 20, 0),
  ('s-blanche', 1, 'Sauce blanche', 1.0, 80, 1),
  ('thon', 2, 'Thon', 3.0, 120, 0),
  ('escalope', 2, 'Escalope', 4.5, 200, 1),
  ('fromage', 2, 'Fromage', 2.0, 110, 2),
  ('olives', 2, 'Olives', 1.0, 15, 3);

-- Les produits créés ensuite depuis l'admin prennent des ids à partir de 100
SELECT setval('products_id_seq', GREATEST(100, (SELECT max(id) + 1 FROM products)), false);
