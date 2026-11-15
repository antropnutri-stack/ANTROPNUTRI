-- ANTROPNUTRI · Nuevo tipo de solicitud: volver a medir una medición ya registrada.
-- (Va en una migración propia porque un valor nuevo de enum no puede usarse en la misma transacción.)
alter type request_type add value if not exists 'remedicion';
