-- =====================================================================
-- ANTROPNUTRI · Datos iniciales de la campaña (v2: promociones)
-- Requisito: usuario adm-001@antropnutri.local creado en Authentication > Users.
-- =====================================================================

insert into campaigns (name, event_date, is_active)
values ('Evaluación antropométrica 2026', current_date, true);

-- Promociones (numeración única compartida)
insert into groups (campaign_id, code, range_start, range_end)
select c.id, g.code, 1, 9999
from campaigns c, (values ('JUSTICIEROS'), ('AGUERRIDOS')) as g(code)
where c.is_active;

insert into profiles (id, code, full_name, display_name, role)
select id, 'ADM-001', 'Administrador principal', 'ADMINISTRACIÓN', 'principal'
from auth.users where email = 'adm-001@antropnutri.local'
on conflict (id) do update set role = 'principal', status = 'activa';
