-- 005 : prix d'une heure de terrain, fixé par l'admin (vide tant qu'il n'est pas fixé).
-- La réservation garde le prix du moment : changer le tarif ne modifie pas les réservations déjà faites.
ALTER TABLE pitches ADD COLUMN price_mil INT CHECK (price_mil > 0);
ALTER TABLE reservations ADD COLUMN price_mil INT CHECK (price_mil > 0);
