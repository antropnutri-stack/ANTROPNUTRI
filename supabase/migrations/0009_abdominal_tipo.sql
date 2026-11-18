-- ANTROPNUTRI · Nueva variable: perímetro abdominal (migración propia por ser valor de enum)
alter type variable add value if not exists 'perimetro_abdominal' after 'cintura';
