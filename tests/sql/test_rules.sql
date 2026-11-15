-- Pruebas de reglas de negocio. Se ejecuta con psql -v ON_ERROR_STOP=1
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;  -- igual que Supabase

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','adm-001@antropnutri.local'),
 ('00000000-0000-0000-0000-000000000002','adm-002@antropnutri.local'),
 ('00000000-0000-0000-0000-000000000003','adm-003@antropnutri.local'),
 ('00000000-0000-0000-0000-0000000000a1','eva-001@antropnutri.local'),
 ('00000000-0000-0000-0000-0000000000a2','eva-002@antropnutri.local'),
 ('00000000-0000-0000-0000-0000000000b1','eva-007@antropnutri.local');
\i supabase/seed.sql
insert into profiles(id,code,full_name,display_name,role,can_resolve_requests,can_manage_participants) values
 ('00000000-0000-0000-0000-000000000002','ADM-002','Admin dos','ADM. DOS','admin',true,true),
 ('00000000-0000-0000-0000-000000000003','ADM-003','Admin tres','ADM. TRES','admin',false,false);
insert into profiles(id,code,full_name,display_name,group_id,station)
 select '00000000-0000-0000-0000-0000000000a1','EVA-001','Drake Pérez','NUT. DRAKE',id,'peso' from groups where code='A';
insert into profiles(id,code,full_name,display_name,group_id,station)
 select '00000000-0000-0000-0000-0000000000a2','EVA-002','Ana Ruiz','EST. ANA',id,'registro' from groups where code='A';
insert into profiles(id,code,full_name,display_name,group_id,station)
 select '00000000-0000-0000-0000-0000000000b1','EVA-007','Beto Díaz','NUT. BETO',id,'peso' from groups where code='B';

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'FALLO: %', msg; end if; raise notice 'OK: %', msg; end $$;
create or replace function pg_temp.fails(q text, expect text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like '%'||expect||'%' then raise notice 'OK: % (%)', msg, sqlerrm; return; end if;
    raise exception 'FALLO: % – error inesperado: %', msg, sqlerrm;
  end;
  raise exception 'FALLO: % – no lanzó error', msg;
end $$;

set role authenticated;

-- Registro manual por estación de registro
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.check((register_participant('Juan  Quispe Mamani','M','2005-03-10'))->>'number' = '1', 'registro asigna número 001 en grupo A');
select pg_temp.check((register_participant('juan quispe mamani','M','2005-03-10'))->>'status' = 'posible_duplicado', 'detecta duplicado');
select pg_temp.check((register_participant('María Flores','F',null,20))->>'number' = '2', 'segundo participante 002');

-- Evaluador de peso no puede registrar participantes ni escribir directo
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select register_participant('X Y Z','M',null,20)$$, 'NO_AUTORIZADO', 'peso no registra participantes');
select pg_temp.fails($$insert into measurements(participant_id,variable,value,evaluator_id) select id,'talla',170,'00000000-0000-0000-0000-0000000000a1' from participants limit 1$$, 'row-level security', 'RLS bloquea insert directo');

-- Mediciones
select pg_temp.check((save_measurement(1,'peso',68.5))->>'status'='guardado', 'peso guardado');
select pg_temp.check((save_measurement(1,'peso',70))->>'status'='ya_existe', 'no sobrescribe silenciosamente');
select pg_temp.fails($$select save_measurement(1,'talla',170)$$, 'no corresponde a su estación', 'peso no registra talla');
select pg_temp.fails($$select save_measurement(2,'peso',500)$$, 'FUERA_DE_RANGO', 'rango duro');
select pg_temp.check((save_measurement(2,'peso',135))->>'status'='requiere_confirmacion', 'valor inusual pide confirmación');
select pg_temp.check((save_measurement(2,'peso',135,true,'11111111-1111-1111-1111-111111111111'))->>'status'='guardado', 'inusual confirmado');
select pg_temp.check((save_measurement(2,'peso',135,true,'11111111-1111-1111-1111-111111111111'))->>'status'='ya_guardado', 'idempotente por client_op_id');

-- Evaluador del grupo B no ve ni mide participantes de A
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from participants)=0, 'grupo B no ve participantes de A');
select pg_temp.check((select count(*) from measurements)=0, 'grupo B no ve mediciones de A');
select pg_temp.fails($$select save_measurement(1,'peso',70)$$, 'otro grupo', 'B no mide a A sin apoyo');

-- Solicitud de apoyo (desde A hacia B, para peso de 003)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.check((register_participant('Luis Torres','M','2004-01-01'))->>'number'='3', 'participante 003');
select pg_temp.fails($$select create_support_request(3,'apoyo_temporal','',(select id from groups where code='B'),array['peso']::variable[])$$, 'MOTIVO', 'motivo obligatorio');
select create_support_request(3,'apoyo_temporal','Balanza del grupo A en calibración',(select id from groups where code='B'),array['peso']::variable[]) as req \gset
select pg_temp.fails($$select create_support_request(3,'apoyo_temporal','otra vez',(select id from groups where code='B'),array['peso']::variable[])$$, 'DUPLICADA', 'no duplica solicitudes pendientes');

select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select pg_temp.fails(format($$select resolve_support_request(%L,true)$$, :'req'), 'NO_AUTORIZADO', 'admin sin permiso no resuelve');
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select pg_temp.check((resolve_support_request(:'req',true,'ok'))->>'status'='aprobada', 'autorizador aprueba');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check((resolve_support_request(:'req',false))->>'status'='ya_resuelta', 'no se resuelve dos veces');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from participants)=1, 'B ve solo al participante con apoyo');
select pg_temp.check((save_measurement(3,'peso',72))->>'status'='guardado', 'B mide con apoyo aprobado');
select pg_temp.check((select status from support_requests where id=:'req')='finalizada', 'apoyo finaliza al completar');
select pg_temp.check((select count(*) from participants)=0, 'acceso de B termina al finalizar');

-- Traslado permanente conserva número
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select create_support_request(2,'traslado','Cambio de turno',(select id from groups where code='B'),null) as req2 \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select resolve_support_request(:'req2',true);
select pg_temp.check((select g.code from participants p join groups g on g.id=p.group_id where number=2)='B', 'traslado cambia grupo, conserva número');

-- Indicadores
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select pg_temp.fails($$select save_measurement(1,'talla',170)$$, 'no tiene habilitado', 'admin sin permiso de registro');
update profiles set can_export = true where code='ADM-003';
select pg_temp.check((select not can_export from profiles where code='ADM-003'), 'RLS impide autoasignarse permisos');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select save_measurement(1,'talla',170), save_measurement(1,'cintura',78), save_measurement(1,'perimetro_braquial',29), save_measurement(1,'pliegue_tricipital',12);
select pg_temp.check((select imc from participant_results where number=1)=23.7, 'IMC 23.7');
select pg_temp.check((select imc_clasificacion from participant_results where number=1)='Peso normal', 'clasificación IMC');
select pg_temp.check((select rct from participant_results where number=1)=0.459, 'RCT 0.459');
select pg_temp.check((select cmb from participant_results where number=1)=25.2, 'CMB 25.2');
select pg_temp.check((select estado from participant_results where number=1)='completo', 'estado completo');
select pg_temp.check((select estado from participant_results where number=3)='en_proceso', 'estado en proceso');

-- Corrección auditada
select id as mid from measurements m where variable='peso' and participant_id=(select id from participants where number=1) \gset
select correct_measurement(:'mid', 68.7, 'Error de digitación verificado');
select pg_temp.check((select count(*) from audit_log where action='medicion_corregida')=1, 'corrección auditada');

-- Importación
select pg_temp.check((import_participants('[{"full_name":"Ana Uno","sex":"F","age":19},{"full_name":"Beto Dos","sex":"M","birth_date":"2003-05-05","group_code":"C"},{"full_name":"Mal","sex":"X","age":20}]'))->>'inserted'='2', 'importa 2 de 3 y reporta error');
select pg_temp.check((select min(number) from participants p join groups g on g.id=p.group_id where g.code='C')=201, 'importado en grupo C con número 201');


-- ===== Volver a medir con autorización =====
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((save_measurement(1,'peso',69.5))->>'status'='ya_existe', 'sin autorización no se repite');
select pg_temp.fails($$select create_support_request(1,'apoyo_temporal','repetir',(select id from groups where code='B'),array['peso']::variable[])$$, 'Volver a medir', 'apoyo no sirve para medición ya hecha (sugiere volver a medir)');
select pg_temp.fails($$select create_support_request(3,'remedicion','No hay cintura',null,array['cintura']::variable[])$$, 'SIN_MEDICIONES', 'no se pide volver a medir algo no medido');
select create_support_request(1,'remedicion','Participante se movió en la balanza',null,array['peso']::variable[]) as rq \gset
select pg_temp.check((select target_group_id = origin_group_id from support_requests where id=:'rq'), 're-medición dentro del mismo grupo');
select pg_temp.check((save_measurement(1,'peso',69.5))->>'status'='ya_existe', 'pendiente de aprobación: aún no se repite');
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select resolve_support_request(:'rq', true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((save_measurement(1,'peso',69.5))->>'remedicion'='true', 'aprobada: se repite la medición');
select pg_temp.check((select value from measurements m join participants p on p.id=m.participant_id where p.number=1 and variable='peso')=69.5, 'nuevo valor guardado');
select pg_temp.check((select status from support_requests where id=:'rq')='finalizada', 're-medición finaliza al completarse');
select pg_temp.check((save_measurement(1,'peso',71))->>'status'='ya_existe', 'la autorización se usa una sola vez');
reset role;
select pg_temp.check((select (details->>'old')::numeric = 68.7 and (details->>'new')::numeric = 69.5 from audit_log where action='medicion_repetida' order by id desc limit 1), 'auditoría guarda valor anterior y nuevo');
set role authenticated;
-- una re-medición aprobada no se cierra sola cuando se registran otras variables
select create_support_request(3,'remedicion','Lectura dudosa',null,array['peso']::variable[]) as rq2 \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select resolve_support_request(:'rq2', true);
select save_measurement(3,'cintura',80);
select pg_temp.check((select status from support_requests where id=:'rq2')='aprobada', 'otra medición no cierra la re-medición');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((save_measurement(3,'peso',73))->>'status'='guardado', 'estación del grupo repite el peso');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from participants where number=3)=0, 'otro grupo no ve la re-medición interna');

-- Evaluador no ve auditoría
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((select count(*) from audit_log)=0, 'evaluador no ve auditoría');
-- Suspensión
reset role; update profiles set status='suspendida' where code='EVA-001'; set role authenticated;
select pg_temp.fails($$select save_measurement(3,'peso',70)$$, 'NO_AUTORIZADO', 'cuenta suspendida no registra');
select 'TODAS LAS PRUEBAS PASARON' as resultado;
