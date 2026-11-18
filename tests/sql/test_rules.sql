-- Pruebas de reglas de negocio (v2). Se ejecuta con tests/sql/run.sh
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','adm-001@antropnutri.local'),
 ('00000000-0000-0000-0000-000000000002','edwar@antropnutri.local'),
 ('00000000-0000-0000-0000-0000000000a1','jhois@antropnutri.local'),
 ('00000000-0000-0000-0000-0000000000a2','bill@antropnutri.local');
\i supabase/seed.sql
insert into profiles(id,code,full_name,display_name,role,can_resolve_requests,can_manage_participants) values
 ('00000000-0000-0000-0000-000000000002','EDWAR','Lic. Edwar Torres','LIC. EDWAR TORRES','admin',true,true);
insert into profiles(id,code,full_name,display_name) values
 ('00000000-0000-0000-0000-0000000000a1','JHOIS','Arapa Chusi Jhois Samira','JHOIS ARAPA'),
 ('00000000-0000-0000-0000-0000000000a2','BILL','Arratia Soto Bill Aldair','BILL ARRATIA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'FALLO: %', msg; end if; raise notice 'OK: %', msg; end $$;
create or replace function pg_temp.fails(q text, expect text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like '%'||expect||'%' then raise notice 'OK: % (%)', msg, sqlerrm; return; end if;
    raise exception 'FALLO: % – error inesperado: %', msg, sqlerrm;
  end;
  raise exception 'FALLO: % – no lanzó error', msg;
end $$;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((register_participant('Juan Quispe Mamani','12345678',20,(select id from groups where code='JUSTICIEROS')))->>'number'='1', 'evaluador registra participante 001');
select pg_temp.check((register_participant('María Flores','87654321',19,(select id from groups where code='AGUERRIDOS')))->>'number'='2', 'numeración compartida: 002 en otra promoción');
select pg_temp.fails($$select register_participant('Otro','12345678',20,(select id from groups where code='AGUERRIDOS'))$$, 'DNI_DUPLICADO', 'DNI duplicado');
select pg_temp.fails($$select register_participant('Otro Más','123',20,(select id from groups where code='AGUERRIDOS'))$$, 'DNI_INVALIDO', 'DNI de 8 dígitos');
select pg_temp.fails($$select register_participant('Sin Promo','11112222',20,null)$$, 'PROMOCION_REQUERIDA', 'promoción obligatoria');

-- cualquier evaluador, cualquier medición, cualquier promoción
select pg_temp.check((save_measurement(2,'cadera',95))->>'status'='guardado', 'evaluador mide cadera de otra promoción');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.check((select count(*) from participants)=2, 'evaluador ve a todos los participantes');
select pg_temp.check((save_measurement(1,'peso',68.5))->>'status'='guardado', 'peso');
select save_measurement(1,'talla',170), save_measurement(1,'cintura',78), save_measurement(1,'perimetro_braquial',29),
       save_measurement(1,'cadera',96), save_measurement(1,'pliegue_tricipital',12), save_measurement(1,'pliegue_subescapular',14),
       save_measurement(1,'pliegue_suprailiaco',16), save_measurement(1,'pliegue_bicipital',6);
select pg_temp.check((save_measurement(1,'peso',70))->>'status'='ya_existe', 'no sobrescribe sin autorización');
select pg_temp.check((select estado from participant_results where number=1)='completo', 'completo con 9 mediciones');
select pg_temp.check((select imc from participant_results where number=1)=23.7, 'IMC 23.7');
select pg_temp.check((select icc from participant_results where number=1)=0.813, 'ICC 0.813');
select pg_temp.check((select suma_pliegues from participant_results where number=1)=48, 'suma de 4 pliegues 48');
select pg_temp.check((select estado from participant_results where number=2)='en_proceso', 'en proceso');
select pg_temp.fails($$select save_measurement(1,'pliegue_bicipital',90)$$, 'FUERA_DE_RANGO', 'rango de pliegue bicipital');

-- volver a medir sigue funcionando
select create_support_request(1,'remedicion','Lectura dudosa',null,array['peso']::variable[]) as rq \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select resolve_support_request(:'rq', true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((save_measurement(1,'peso',69))->>'remedicion'='true', 'cualquier evaluador repite con autorización');
select pg_temp.check((save_measurement(1,'peso',71))->>'status'='ya_existe', 'autorización de un solo uso');

-- seguridad
select pg_temp.fails($$insert into measurements(participant_id,variable,value,evaluator_id) select id,'talla',170,'00000000-0000-0000-0000-0000000000a1' from participants limit 1$$, 'row-level security', 'RLS bloquea escritura directa');
select pg_temp.check((select count(*) from audit_log)=0, 'evaluador no ve auditoría');
select pg_temp.fails($$select import_participants('[]'::jsonb)$$, 'NO_AUTORIZADO', 'evaluador no importa Excel');
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select pg_temp.check((import_participants('[{"full_name":"Ana Uno","dni":"44445555","age":19,"group_code":"aguerridos"},{"full_name":"Mal","age":20,"group_code":"OTRA"}]'))->>'inserted'='1', 'importa con promoción y reporta error');
reset role; update profiles set status='suspendida' where code='BILL'; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.fails($$select save_measurement(2,'peso',60)$$, 'NO_AUTORIZADO', 'cuenta suspendida no registra');
select pg_temp.check((select count(*) from participants)=0, 'cuenta suspendida no ve datos');
