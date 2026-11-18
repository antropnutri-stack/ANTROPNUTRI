-- ANTROPNUTRI v2 · nuevas variables (migración propia: los valores de enum se usan en la siguiente)
alter type variable add value if not exists 'cadera';
alter type variable add value if not exists 'pliegue_subescapular';
alter type variable add value if not exists 'pliegue_suprailiaco';
alter type variable add value if not exists 'pliegue_bicipital';
