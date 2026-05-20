-- Allow fractional prices (e.g. £3.50, £5.50)
-- price_per_player was int, now numeric(10,2)
ALTER TABLE schedule
ALTER COLUMN price_per_player TYPE numeric(10,2);
