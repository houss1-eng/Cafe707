-- 002 : le client ne choisit plus son moyen de paiement.
-- Il reste vide jusqu'à l'encaissement, où le serveur note le vrai moyen (paid_method).
ALTER TABLE orders ALTER COLUMN payment DROP NOT NULL;
