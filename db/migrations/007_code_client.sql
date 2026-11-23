-- 007 : plus de SMS. Chaque client a un code personnel à 6 chiffres, montré une seule fois à la création du compte.
-- Seul son hash est gardé. Un compte sans code doit en recevoir un nouveau de l'admin.
ALTER TABLE clients ADD COLUMN pin_hash TEXT;
DROP TABLE otp_codes;
