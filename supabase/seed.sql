-- =====================================================================
-- ANTROPNUTRI · Datos iniciales de la campaña
-- 1) Ejecute 0001_init.sql
-- 2) Cree en Supabase > Authentication > Users el usuario principal con el correo
--    adm-001@antropnutri.local (o el código que prefiera) y una contraseña segura.
-- 3) Reemplace el correo abajo si usó otro y ejecute este archivo.
-- =====================================================================

insert into campaigns (name, event_date, is_active)
values ('Evaluación antropométrica 2026', current_date, true);

insert into groups (campaign_id, code, range_start, range_end)
select c.id, g.code, g.s, g.e
from campaigns c,
  (values ('A',1,100),('B',101,200),('C',201,300),('D',301,400),('E',401,500)) as g(code,s,e)
where c.is_active;

insert into profiles (id, code, full_name, display_name, role)
select id, 'ADM-001', 'Administrador principal', 'ADMINISTRACIÓN', 'principal'
from auth.users where email = 'adm-001@antropnutri.local'
on conflict (id) do update set role = 'principal', status = 'activa';
