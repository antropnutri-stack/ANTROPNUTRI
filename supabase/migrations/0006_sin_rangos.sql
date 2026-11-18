-- ANTROPNUTRI · Solo recolección de datos: sin rangos de plausibilidad ni avisos de valor inusual
update plausibility_ranges set hard_min = 0.1, warn_min = 0.1, warn_max = 999, hard_max = 999;
