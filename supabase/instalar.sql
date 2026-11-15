-- ANTROPNUTRI · INSTALACIÓN COMPLETA (esquema + campaña inicial + administrador principal)
-- Requisito: haber creado antes el usuario adm-001@antropnutri.local en Authentication > Users.
-- Ejecute en el SQL Editor en DOS partes: primero 0002 (tipo de solicitud) y luego el resto, o use apply_migration.

-- =====================================================================
-- ANTROPNUTRI · Esquema inicial
-- PostgreSQL / Supabase. Ejecutar en el SQL Editor o con `supabase db push`.
--
-- Principios:
--   * Ningún cliente escribe directamente en tablas sensibles: las escrituras
--     pasan por funciones SECURITY DEFINER que validan permisos y reglas.
--   * RLS activado en todas las tablas; lectura según función y grupo.
--   * Toda operación relevante queda en audit_log.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type app_role as enum ('principal', 'admin', 'evaluador');
create type account_status as enum ('activa', 'suspendida', 'desactivada');
create type station as enum ('registro', 'peso', 'talla', 'cintura', 'brazo', 'supervision');
create type variable as enum ('peso', 'talla', 'cintura', 'perimetro_braquial', 'pliegue_tricipital');
create type sex as enum ('M', 'F');
create type request_type as enum ('apoyo_temporal', 'apoyo_varias', 'traslado');
create type request_status as enum ('pendiente', 'aprobada', 'rechazada', 'cancelada', 'finalizada');

-- ---------------------------------------------------------------------
-- Campañas (permite reutilizar el sistema en futuras jornadas)
-- ---------------------------------------------------------------------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date not null default current_date,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
-- Solo una campaña activa a la vez
create unique index campaigns_one_active on campaigns (is_active) where is_active;

create table groups (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  code text not null,                      -- 'A'..'E'
  range_start int not null,
  range_end int not null,
  unique (campaign_id, code),
  check (range_start > 0 and range_end >= range_start)
);

-- ---------------------------------------------------------------------
-- Perfiles de usuario (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,               -- EVA-001, ADM-001
  full_name text not null,
  display_name text not null,              -- «NUT. DRAKE»
  role app_role not null default 'evaluador',
  group_id uuid references groups(id) on delete set null,
  station station,
  status account_status not null default 'activa',
  -- permisos por función (el principal los tiene todos implícitamente)
  can_register_measurements boolean not null default false,
  can_create_evaluators boolean not null default false,
  can_resolve_requests boolean not null default false,
  can_change_group boolean not null default false,
  can_manage_participants boolean not null default false,
  can_export boolean not null default false,
  can_view_audit boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Configuración de rangos de plausibilidad (editable por administración)
-- hard_*: fuera de este rango se rechaza (error de digitación evidente)
-- warn_*: fuera de este rango se exige confirmación explícita
-- ---------------------------------------------------------------------
create table plausibility_ranges (
  variable variable primary key,
  unit text not null,
  hard_min numeric not null,
  hard_max numeric not null,
  warn_min numeric not null,
  warn_max numeric not null,
  decimals int not null default 1,
  check (hard_min > 0 and hard_min <= warn_min and warn_min < warn_max and warn_max <= hard_max)
);

insert into plausibility_ranges values
  ('peso',               'kg', 25,  250, 40,  130, 1),
  ('talla',              'cm', 120, 220, 145, 200, 1),
  ('cintura',            'cm', 40,  200, 58,  120, 1),
  ('perimetro_braquial', 'cm', 12,  60,  20,  42,  1),
  ('pliegue_tricipital', 'mm', 2,   60,  4,   40,  1);

-- Criterios de interpretación configurables (p. ej. punto de corte de RCT)
create table settings (
  key text primary key,
  value jsonb not null
);
insert into settings values
  ('rct_cutoff', '0.5'::jsonb),
  ('adult_min_age', '18'::jsonb);

-- ---------------------------------------------------------------------
-- Participantes
-- ---------------------------------------------------------------------
create table participants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  number int not null,
  full_name text not null,
  birth_date date,
  age int,
  sex sex not null,
  group_id uuid not null references groups(id),
  needs_review boolean not null default false,
  review_note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, number),
  check (number between 1 and 9999),
  check (age is null or age between 0 and 120),
  check (birth_date is not null or age is not null)
);
create index participants_group on participants(group_id);
-- Clave para detectar duplicados (nombre normalizado + fecha de nacimiento)
create index participants_dupkey on participants (campaign_id, lower(regexp_replace(full_name, '\s+', ' ', 'g')), birth_date);

-- ---------------------------------------------------------------------
-- Mediciones: un único valor final por participante y variable
-- ---------------------------------------------------------------------
create table measurements (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  variable variable not null,
  value numeric(6,2) not null check (value > 0),
  is_unusual boolean not null default false,       -- fuera de rango de advertencia, confirmado por evaluador
  evaluator_id uuid not null references profiles(id),
  support_request_id uuid,                          -- si se registró vía apoyo autorizado
  client_op_id uuid unique,                         -- idempotencia para sincronización sin conexión
  recorded_at timestamptz not null default now(),   -- hora en el dispositivo (o servidor)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, variable)
);

-- ---------------------------------------------------------------------
-- Solicitudes de apoyo y traslado
-- ---------------------------------------------------------------------
create table support_requests (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  type request_type not null,
  reason text not null check (length(trim(reason)) >= 3),
  origin_group_id uuid not null references groups(id),
  target_group_id uuid not null references groups(id),
  variables variable[] not null default '{}',
  status request_status not null default 'pendiente',
  requested_by uuid not null references profiles(id),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  check (type = 'traslado' or cardinality(variables) >= 1),
  check (origin_group_id <> target_group_id)
);
create index support_requests_status on support_requests(status);

alter table measurements
  add constraint measurements_support_fk foreign key (support_request_id) references support_requests(id);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_entity on audit_log(entity, entity_id);
create index audit_log_created on audit_log(created_at desc);

-- =====================================================================
-- Funciones auxiliares de permisos
-- =====================================================================
create or replace function me() returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid() and status = 'activa'
$$;

create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'activa')
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'activa' and role in ('principal','admin'))
$$;

create or replace function has_perm(perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  select * into p from profiles where id = auth.uid() and status = 'activa';
  if not found then return false; end if;
  if p.role = 'principal' then return true; end if;
  if p.role <> 'admin' and perm <> 'register_measurements' then return false; end if;
  return case perm
    when 'register_measurements' then p.can_register_measurements
    when 'create_evaluators'     then p.can_create_evaluators
    when 'resolve_requests'      then p.can_resolve_requests
    when 'change_group'          then p.can_change_group
    when 'manage_participants'   then p.can_manage_participants
    when 'export'                then p.can_export
    when 'view_audit'            then p.can_view_audit
    else false end;
end $$;

create or replace function active_campaign() returns uuid
language sql stable security definer set search_path = public as $$
  select id from campaigns where is_active limit 1
$$;

-- Variables que corresponden a cada estación
create or replace function station_variables(s station) returns variable[]
language sql immutable set search_path = public as $$
  select case s
    when 'peso' then array['peso']::variable[]
    when 'talla' then array['talla']::variable[]
    when 'cintura' then array['cintura']::variable[]
    when 'brazo' then array['perimetro_braquial','pliegue_tricipital']::variable[]
    when 'supervision' then array['peso','talla','cintura','perimetro_braquial','pliegue_tricipital']::variable[]
    else array[]::variable[] end
$$;

-- ¿Puede el usuario actual ver a este participante?
-- Admin: todos. Evaluador: los de su grupo, o los cubiertos por un apoyo aprobado hacia su grupo.
create or replace function can_see_participant(pid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  select * into p from profiles where id = auth.uid() and status = 'activa';
  if not found then return false; end if;
  if p.role in ('principal','admin') then return true; end if;
  return exists (select 1 from participants where id = pid and group_id = p.group_id)
      or exists (select 1 from support_requests r
                 where r.participant_id = pid and r.status = 'aprobada'
                   and r.target_group_id = p.group_id);
end $$;

create or replace function audit(p_action text, p_entity text, p_id uuid, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log(actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_id, coalesce(p_details, '{}'::jsonb))
$$;

-- =====================================================================
-- Indicadores derivados
-- =====================================================================
create or replace function bmi_class(bmi numeric, age int) returns text
language sql immutable set search_path = public as $$
  select case
    when bmi is null then null
    when age is not null and age < 18 then 'No aplica (menor de 18)'
    when bmi < 18.5 then 'Bajo peso'
    when bmi < 25 then 'Peso normal'
    when bmi < 30 then 'Sobrepeso'
    else 'Obesidad' end
$$;

create or replace view participant_results with (security_invoker = true) as
with m as (
  select participant_id,
    max(value) filter (where variable = 'peso') as peso,
    max(value) filter (where variable = 'talla') as talla,
    max(value) filter (where variable = 'cintura') as cintura,
    max(value) filter (where variable = 'perimetro_braquial') as perimetro_braquial,
    max(value) filter (where variable = 'pliegue_tricipital') as pliegue_tricipital,
    count(*) as n_measurements,
    bool_or(is_unusual) as any_unusual
  from measurements group by participant_id
), base as (
  select p.id, p.campaign_id, p.number, p.full_name, p.sex, p.birth_date,
    coalesce(p.age, extract(year from age(c.event_date, p.birth_date))::int) as age,
    p.group_id, g.code as group_code, p.needs_review, p.review_note, c.event_date,
    m.peso, m.talla, m.cintura, m.perimetro_braquial, m.pliegue_tricipital,
    coalesce(m.n_measurements, 0)::int as n_measurements,
    coalesce(m.any_unusual, false) as any_unusual
  from participants p
  join groups g on g.id = p.group_id
  join campaigns c on c.id = p.campaign_id
  left join m on m.participant_id = p.id
)
select b.*,
  round(b.peso / power(b.talla / 100.0, 2), 1) as imc,
  bmi_class(round(b.peso / power(b.talla / 100.0, 2), 1), b.age) as imc_clasificacion,
  round(b.cintura / b.talla, 3) as rct,
  round(b.perimetro_braquial - pi()::numeric * (b.pliegue_tricipital / 10.0), 1) as cmb,
  case
    when b.needs_review then 'requiere_revision'
    when b.n_measurements = 0 then 'sin_iniciar'
    when b.n_measurements < 5 then 'en_proceso'
    else 'completo' end as estado
from base b;

-- =====================================================================
-- Operaciones (RPC). Toda escritura de la app pasa por aquí.
-- =====================================================================

-- Registrar o devolver una medición. Idempotente por client_op_id.
create or replace function save_measurement(
  p_participant_number int,
  p_variable variable,
  p_value numeric,
  p_confirm_unusual boolean default false,
  p_client_op_id uuid default null,
  p_recorded_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u profiles;
  part participants;
  rng plausibility_ranges;
  existing measurements;
  req_id uuid;
  unusual boolean;
  new_id uuid;
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO: cuenta inactiva o inexistente'; end if;

  -- Idempotencia: si esta operación ya se aplicó, devolver el mismo resultado
  if p_client_op_id is not null then
    select * into existing from measurements where client_op_id = p_client_op_id;
    if found then
      return jsonb_build_object('status','ya_guardado','id',existing.id,'value',existing.value);
    end if;
  end if;

  select * into part from participants
   where campaign_id = active_campaign() and number = p_participant_number;
  if not found then raise exception 'NO_ENCONTRADO: participante % no registrado', p_participant_number; end if;

  -- Permiso según rol
  if u.role in ('principal','admin') then
    if not has_perm('register_measurements') then
      raise exception 'NO_AUTORIZADO: su cuenta no tiene habilitado el registro de mediciones';
    end if;
  else
    if not (p_variable = any(station_variables(u.station))) then
      raise exception 'NO_AUTORIZADO: la variable % no corresponde a su estación', p_variable;
    end if;
    if part.group_id <> u.group_id then
      select r.id into req_id from support_requests r
       where r.participant_id = part.id and r.status = 'aprobada'
         and r.target_group_id = u.group_id
         and (r.type = 'traslado' or p_variable = any(r.variables))
       order by r.resolved_at desc limit 1;
      if req_id is null then
        raise exception 'NO_AUTORIZADO: el participante % pertenece a otro grupo y no hay apoyo aprobado para esta medición', part.number;
      end if;
    end if;
  end if;

  -- Validación de rango
  select * into rng from plausibility_ranges where variable = p_variable;
  if p_value is null or p_value <= 0 then raise exception 'VALOR_INVALIDO: debe ser un número positivo'; end if;
  if p_value < rng.hard_min or p_value > rng.hard_max then
    raise exception 'FUERA_DE_RANGO: % % está fuera del rango admisible (% – %)', p_value, rng.unit, rng.hard_min, rng.hard_max;
  end if;
  unusual := p_value < rng.warn_min or p_value > rng.warn_max;
  if unusual and not coalesce(p_confirm_unusual, false) then
    return jsonb_build_object('status','requiere_confirmacion','warn_min',rng.warn_min,'warn_max',rng.warn_max,'unit',rng.unit);
  end if;

  -- No sobrescribir silenciosamente
  select * into existing from measurements where participant_id = part.id and variable = p_variable;
  if found then
    return jsonb_build_object('status','ya_existe','id',existing.id,'value',existing.value,
                              'evaluator_id',existing.evaluator_id);
  end if;

  insert into measurements(participant_id, variable, value, is_unusual, evaluator_id,
                           support_request_id, client_op_id, recorded_at)
  values (part.id, p_variable, round(p_value, rng.decimals), unusual, u.id,
          req_id, p_client_op_id, coalesce(p_recorded_at, now()))
  on conflict (participant_id, variable) do nothing
  returning id into new_id;

  if new_id is null then  -- carrera con otro dispositivo
    select * into existing from measurements where participant_id = part.id and variable = p_variable;
    return jsonb_build_object('status','ya_existe','id',existing.id,'value',existing.value,
                              'evaluator_id',existing.evaluator_id);
  end if;

  perform audit('medicion_registrada', 'measurement', new_id,
    jsonb_build_object('participant', part.number, 'variable', p_variable, 'value', p_value,
                       'unusual', unusual, 'support_request', req_id));

  -- Cerrar apoyos temporales cuando todas sus mediciones estén completas
  update support_requests r set status = 'finalizada'
   where r.participant_id = part.id and r.status = 'aprobada' and r.type <> 'traslado'
     and not exists (select 1 from unnest(r.variables) v
                     where not exists (select 1 from measurements mm
                                       where mm.participant_id = part.id and mm.variable = v));

  return jsonb_build_object('status','guardado','id',new_id,'unusual',unusual);
end $$;

-- Corrección de una medición existente (solo administración, con motivo)
create or replace function correct_measurement(p_measurement_id uuid, p_new_value numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old measurements; rng plausibility_ranges;
begin
  if not has_perm('manage_participants') then raise exception 'NO_AUTORIZADO'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'MOTIVO_REQUERIDO'; end if;
  select * into old from measurements where id = p_measurement_id for update;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  select * into rng from plausibility_ranges where variable = old.variable;
  if p_new_value < rng.hard_min or p_new_value > rng.hard_max then raise exception 'FUERA_DE_RANGO'; end if;
  update measurements set value = round(p_new_value, rng.decimals),
    is_unusual = p_new_value < rng.warn_min or p_new_value > rng.warn_max,
    updated_at = now()
  where id = p_measurement_id;
  perform audit('medicion_corregida', 'measurement', old.id,
    jsonb_build_object('variable', old.variable, 'old', old.value, 'new', p_new_value,
                       'reason', p_reason, 'original_evaluator', old.evaluator_id));
end $$;

create or replace function delete_measurement(p_measurement_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old measurements;
begin
  if not has_perm('manage_participants') then raise exception 'NO_AUTORIZADO'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'MOTIVO_REQUERIDO'; end if;
  delete from measurements where id = p_measurement_id returning * into old;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  perform audit('medicion_anulada', 'measurement', old.id,
    jsonb_build_object('variable', old.variable, 'value', old.value, 'reason', p_reason,
                       'original_evaluator', old.evaluator_id));
end $$;

-- Siguiente número libre dentro del rango del grupo (o al final si el rango está lleno)
create or replace function next_number(p_group_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare g groups; n int;
begin
  select * into g from groups where id = p_group_id;
  select min(s) into n from generate_series(g.range_start, g.range_end) s
   where not exists (select 1 from participants where campaign_id = g.campaign_id and number = s);
  if n is null then
    select coalesce(max(number), 0) + 1 into n from participants where campaign_id = g.campaign_id;
  end if;
  return n;
end $$;

-- Registro manual (admin con permiso o evaluador de la estación de registro de su grupo)
create or replace function register_participant(
  p_full_name text, p_sex sex, p_birth_date date default null, p_age int default null,
  p_group_id uuid default null, p_number int default null, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles; gid uuid; camp uuid := active_campaign(); n int; new_id uuid; dup record;
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  if camp is null then raise exception 'SIN_CAMPAÑA: no hay campaña activa'; end if;
  if has_perm('manage_participants') then
    gid := coalesce(p_group_id, u.group_id);
  elsif u.role = 'evaluador' and u.station in ('registro','supervision') then
    gid := u.group_id;
  else
    raise exception 'NO_AUTORIZADO: no puede registrar participantes';
  end if;
  if gid is null then raise exception 'GRUPO_REQUERIDO'; end if;
  if p_full_name is null or length(trim(p_full_name)) < 3 then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_birth_date is null and p_age is null then raise exception 'EDAD_REQUERIDA: indique fecha de nacimiento o edad'; end if;

  if not coalesce(p_force, false) then
    select number, full_name into dup from participants
     where campaign_id = camp
       and lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_full_name), '\s+', ' ', 'g'))
       and (p_birth_date is null or birth_date is null or birth_date = p_birth_date)
     limit 1;
    if found then
      return jsonb_build_object('status','posible_duplicado','number',dup.number,'full_name',dup.full_name);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('numbers:' || camp::text));
  if p_number is not null and has_perm('manage_participants') then
    n := p_number;
    if exists (select 1 from participants where campaign_id = camp and number = n) then
      raise exception 'NUMERO_OCUPADO: el número % ya está asignado', n;
    end if;
  else
    n := next_number(gid);
  end if;

  insert into participants(campaign_id, number, full_name, birth_date, age, sex, group_id, created_by)
  values (camp, n, regexp_replace(trim(p_full_name), '\s+', ' ', 'g'), p_birth_date, p_age, p_sex, gid, u.id)
  returning id into new_id;
  perform audit('participante_registrado', 'participant', new_id,
    jsonb_build_object('number', n, 'group', gid, 'modo', 'manual'));
  return jsonb_build_object('status','registrado','id',new_id,'number',n);
end $$;

-- Importación masiva: recibe un arreglo JSON ya revisado en pantalla.
-- Cada elemento: {full_name, sex, birth_date?, age?, group_code?, number?}
create or replace function import_participants(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare camp uuid := active_campaign(); r jsonb; gid uuid; n int; inserted int := 0; errors jsonb := '[]';
  idx int := 0;
begin
  if not has_perm('manage_participants') then raise exception 'NO_AUTORIZADO'; end if;
  if camp is null then raise exception 'SIN_CAMPAÑA'; end if;
  perform pg_advisory_xact_lock(hashtext('numbers:' || camp::text));
  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    begin
      gid := null;
      n := nullif(r->>'number','')::int;
      if nullif(r->>'group_code','') is not null then
        select id into gid from groups where campaign_id = camp and code = upper(r->>'group_code');
        if gid is null then raise exception 'grupo % no existe', r->>'group_code'; end if;
      elsif n is not null then
        select id into gid from groups where campaign_id = camp and n between range_start and range_end;
      else
        -- Distribución automática: grupo con más espacio libre en su rango
        select g.id into gid from groups g where g.campaign_id = camp
         order by (g.range_end - g.range_start + 1) - (select count(*) from participants p where p.group_id = g.id) desc, g.code
         limit 1;
      end if;
      if gid is null then raise exception 'no se pudo determinar el grupo'; end if;
      if n is null then n := next_number(gid); end if;
      insert into participants(campaign_id, number, full_name, birth_date, age, sex, group_id, created_by)
      values (camp, n, regexp_replace(trim(r->>'full_name'), '\s+', ' ', 'g'),
              nullif(r->>'birth_date','')::date, nullif(r->>'age','')::int,
              upper(r->>'sex')::sex, gid, auth.uid());
      inserted := inserted + 1;
    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'error', sqlerrm, 'data', r);
    end;
  end loop;
  perform audit('participantes_importados', 'participant', null,
    jsonb_build_object('insertados', inserted, 'errores', jsonb_array_length(errors)));
  return jsonb_build_object('inserted', inserted, 'errors', errors);
end $$;

create or replace function update_participant(p_id uuid, p_full_name text, p_sex sex, p_birth_date date, p_age int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old participants;
begin
  if not has_perm('manage_participants') then raise exception 'NO_AUTORIZADO'; end if;
  select * into old from participants where id = p_id for update;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  update participants set full_name = p_full_name, sex = p_sex, birth_date = p_birth_date,
    age = p_age, updated_at = now() where id = p_id;
  perform audit('participante_corregido', 'participant', p_id,
    jsonb_build_object('antes', to_jsonb(old) - 'id' - 'campaign_id',
                       'despues', jsonb_build_object('full_name',p_full_name,'sex',p_sex,'birth_date',p_birth_date,'age',p_age),
                       'reason', p_reason));
end $$;

create or replace function set_review(p_id uuid, p_needs_review boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not (is_admin() or (u.station = 'supervision' and can_see_participant(p_id))) then
    raise exception 'NO_AUTORIZADO';
  end if;
  update participants set needs_review = p_needs_review, review_note = p_note, updated_at = now() where id = p_id;
  perform audit(case when p_needs_review then 'marcado_revision' else 'revision_resuelta' end,
                'participant', p_id, jsonb_build_object('note', p_note));
end $$;

create or replace function change_participant_group(p_id uuid, p_group_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old participants;
begin
  if not has_perm('change_group') then raise exception 'NO_AUTORIZADO'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'MOTIVO_REQUERIDO'; end if;
  select * into old from participants where id = p_id for update;
  update participants set group_id = p_group_id, updated_at = now() where id = p_id;
  perform audit('cambio_grupo', 'participant', p_id,
    jsonb_build_object('from', old.group_id, 'to', p_group_id, 'reason', p_reason, 'number', old.number));
end $$;

-- Crear solicitud de apoyo/traslado
create or replace function create_support_request(
  p_participant_number int, p_type request_type, p_reason text, p_target_group_id uuid, p_variables variable[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare u profiles; part participants; new_id uuid; vars variable[];
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into part from participants where campaign_id = active_campaign() and number = p_participant_number;
  if not found then raise exception 'NO_ENCONTRADO: participante % no registrado', p_participant_number; end if;
  if not can_see_participant(part.id) then raise exception 'NO_AUTORIZADO: participante de otro grupo'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'MOTIVO_REQUERIDO'; end if;
  if p_target_group_id = part.group_id then raise exception 'DESTINO_INVALIDO: el participante ya pertenece a ese grupo'; end if;
  -- Solo mediciones aún pendientes
  select coalesce(array_agg(v), '{}') into vars from unnest(coalesce(p_variables, '{}')) v
   where not exists (select 1 from measurements m where m.participant_id = part.id and m.variable = v);
  if p_type <> 'traslado' and cardinality(vars) = 0 then
    raise exception 'SIN_PENDIENTES: las mediciones seleccionadas ya están registradas';
  end if;
  if exists (select 1 from support_requests where participant_id = part.id and status = 'pendiente') then
    raise exception 'DUPLICADA: ya existe una solicitud pendiente para este participante';
  end if;
  insert into support_requests(participant_id, type, reason, origin_group_id, target_group_id, variables, requested_by)
  values (part.id, p_type, trim(p_reason), part.group_id, p_target_group_id, vars, u.id)
  returning id into new_id;
  perform audit('solicitud_creada', 'support_request', new_id,
    jsonb_build_object('participant', part.number, 'type', p_type, 'target', p_target_group_id, 'variables', vars));
  return new_id;
end $$;

-- Resolver solicitud: el primero que resuelve gana (bloqueo de fila + verificación de estado)
create or replace function resolve_support_request(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r support_requests;
begin
  if not has_perm('resolve_requests') then raise exception 'NO_AUTORIZADO: su cuenta no resuelve solicitudes'; end if;
  select * into r from support_requests where id = p_id for update;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  if r.status <> 'pendiente' then
    return jsonb_build_object('status','ya_resuelta','current',r.status,'resolved_by',r.resolved_by);
  end if;
  update support_requests set status = case when p_approve then 'aprobada' else 'rechazada' end::request_status,
    resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
  where id = p_id;
  if p_approve and r.type = 'traslado' then
    update participants set group_id = r.target_group_id, updated_at = now() where id = r.participant_id;
    update support_requests set status = 'finalizada' where id = p_id;
  end if;
  perform audit(case when p_approve then 'solicitud_aprobada' else 'solicitud_rechazada' end,
    'support_request', p_id, jsonb_build_object('note', p_note, 'type', r.type));
  return jsonb_build_object('status', case when p_approve then 'aprobada' else 'rechazada' end);
end $$;

create or replace function cancel_support_request(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r support_requests;
begin
  select * into r from support_requests where id = p_id for update;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  if not (r.requested_by = auth.uid() or has_perm('resolve_requests')) then raise exception 'NO_AUTORIZADO'; end if;
  if r.status not in ('pendiente','aprobada') then raise exception 'ESTADO_INVALIDO: la solicitud ya está %', r.status; end if;
  update support_requests set status = 'cancelada', resolution_note = coalesce(p_note, resolution_note),
    resolved_by = coalesce(resolved_by, auth.uid()), resolved_at = coalesce(resolved_at, now())
  where id = p_id;
  perform audit('solicitud_cancelada', 'support_request', p_id, jsonb_build_object('note', p_note));
end $$;

-- Gestión de cuentas (los datos de auth se crean en la Edge Function admin-users)
create or replace function update_profile(
  p_id uuid, p_full_name text, p_display_name text, p_group_id uuid, p_station station,
  p_status account_status, p_perms jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare target profiles; caller profiles;
begin
  select * into caller from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into target from profiles where id = p_id for update;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  if target.role = 'principal' and caller.id <> target.id then raise exception 'NO_AUTORIZADO'; end if;
  if target.role = 'admin' and caller.role <> 'principal' then raise exception 'NO_AUTORIZADO: solo el principal modifica administradores'; end if;
  if target.role = 'evaluador' and not has_perm('create_evaluators') then raise exception 'NO_AUTORIZADO'; end if;
  if caller.id = target.id and p_status <> 'activa' then raise exception 'NO_PERMITIDO: no puede desactivar su propia cuenta'; end if;

  update profiles set full_name = p_full_name, display_name = p_display_name, group_id = p_group_id,
    station = p_station, status = p_status
  where id = p_id;

  if p_perms is not null then
    if caller.role <> 'principal' then raise exception 'NO_AUTORIZADO: solo el principal modifica permisos'; end if;
    update profiles set
      can_register_measurements = coalesce((p_perms->>'can_register_measurements')::boolean, can_register_measurements),
      can_create_evaluators     = coalesce((p_perms->>'can_create_evaluators')::boolean, can_create_evaluators),
      can_resolve_requests      = coalesce((p_perms->>'can_resolve_requests')::boolean, can_resolve_requests),
      can_change_group          = coalesce((p_perms->>'can_change_group')::boolean, can_change_group),
      can_manage_participants   = coalesce((p_perms->>'can_manage_participants')::boolean, can_manage_participants),
      can_export                = coalesce((p_perms->>'can_export')::boolean, can_export),
      can_view_audit            = coalesce((p_perms->>'can_view_audit')::boolean, can_view_audit)
    where id = p_id;
  end if;
  perform audit('cuenta_modificada', 'profile', p_id,
    jsonb_build_object('antes', to_jsonb(target), 'status', p_status, 'perms', p_perms));
end $$;

create or replace function update_range(p_variable variable, p_hard_min numeric, p_hard_max numeric,
  p_warn_min numeric, p_warn_max numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'principal' and status = 'activa') then
    raise exception 'NO_AUTORIZADO';
  end if;
  update plausibility_ranges set hard_min = p_hard_min, hard_max = p_hard_max,
    warn_min = p_warn_min, warn_max = p_warn_max where variable = p_variable;
  perform audit('rango_modificado', 'settings', null,
    jsonb_build_object('variable', p_variable, 'hard', array[p_hard_min,p_hard_max], 'warn', array[p_warn_min,p_warn_max]));
end $$;

-- Avance por evaluador (para el panel)
create or replace view evaluator_progress with (security_invoker = true) as
select pr.id, pr.code, pr.display_name, pr.group_id, pr.station, pr.status,
  count(m.id)::int as n_records, max(m.created_at) as last_record
from profiles pr left join measurements m on m.evaluator_id = pr.id
group by pr.id;

-- =====================================================================
-- Seguridad a nivel de fila
-- =====================================================================
alter table campaigns enable row level security;
alter table groups enable row level security;
alter table profiles enable row level security;
alter table plausibility_ranges enable row level security;
alter table settings enable row level security;
alter table participants enable row level security;
alter table measurements enable row level security;
alter table support_requests enable row level security;
alter table audit_log enable row level security;

-- Datos de configuración: lectura para cualquier cuenta activa
create policy campaigns_read on campaigns for select to authenticated using (is_active_user());
create policy groups_read on groups for select to authenticated using (is_active_user());
create policy ranges_read on plausibility_ranges for select to authenticated using (is_active_user());
create policy settings_read on settings for select to authenticated using (is_active_user());

-- Perfiles: cada uno ve el suyo; los administradores ven todos; los evaluadores ven
-- nombres visibles del personal (necesario para mostrar «quién midió»)
create policy profiles_read on profiles for select to authenticated
  using (id = auth.uid() or is_active_user());

create policy participants_read on participants for select to authenticated
  using (can_see_participant(id));

create policy measurements_read on measurements for select to authenticated
  using (can_see_participant(participant_id));

create policy requests_read on support_requests for select to authenticated
  using (is_admin() or requested_by = auth.uid()
         or exists (select 1 from profiles p where p.id = auth.uid()
                    and p.group_id in (origin_group_id, target_group_id)));

create policy audit_read on audit_log for select to authenticated using (has_perm('view_audit'));

-- Sin políticas de INSERT/UPDATE/DELETE: toda escritura va por las funciones anteriores.
-- Configuración de campañas/grupos (principal):
create policy campaigns_write on campaigns for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'principal' and status = 'activa'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'principal' and status = 'activa'));
create policy groups_write on groups for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'principal' and status = 'activa'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'principal' and status = 'activa'));
create policy settings_write on settings for update to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'principal' and status = 'activa'));

-- Las funciones auxiliares no deben ser invocables de forma anónima
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function audit(text, text, uuid, jsonb) from authenticated;
revoke execute on function next_number(uuid) from authenticated;

-- =====================================================================
-- Tiempo real
-- =====================================================================
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table participants, measurements, support_requests, profiles;
  end if;
end $$;

-- ANTROPNUTRI · Nuevo tipo de solicitud: volver a medir una medición ya registrada.
-- (Va en una migración propia porque un valor nuevo de enum no puede usarse en la misma transacción.)
alter type request_type add value if not exists 'remedicion';

-- ANTROPNUTRI · Volver a medir con autorización
-- Un evaluador solicita repetir una medición ya registrada; un autorizador la aprueba;
-- el nuevo valor reemplaza al anterior y la auditoría conserva ambos.

alter table support_requests add column if not exists done_variables variable[] not null default '{}';

-- La re-medición puede hacerla el mismo grupo (origen = destino)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'support_requests'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%origin_group_id <> target_group_id%'
  loop
    execute format('alter table support_requests drop constraint %I', c.conname);
  end loop;
end $$;
alter table support_requests add constraint support_requests_destino_check
  check (type = 'remedicion' or origin_group_id <> target_group_id);

create or replace function create_support_request(
  p_participant_number int, p_type request_type, p_reason text, p_target_group_id uuid, p_variables variable[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare u profiles; part participants; new_id uuid; vars variable[]; target uuid;
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into part from participants where campaign_id = active_campaign() and number = p_participant_number;
  if not found then raise exception 'NO_ENCONTRADO: participante % no registrado', p_participant_number; end if;
  if not can_see_participant(part.id) then raise exception 'NO_AUTORIZADO: participante de otro grupo'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'MOTIVO_REQUERIDO'; end if;

  if p_type = 'remedicion' then
    target := coalesce(p_target_group_id, part.group_id);
    -- Solo mediciones que YA están registradas
    select coalesce(array_agg(v), '{}') into vars from unnest(coalesce(p_variables, '{}')) v
     where exists (select 1 from measurements m where m.participant_id = part.id and m.variable = v);
    if cardinality(vars) = 0 then
      raise exception 'SIN_MEDICIONES: esas mediciones aún no están registradas; regístrelas normalmente';
    end if;
  else
    target := p_target_group_id;
    if target = part.group_id then raise exception 'DESTINO_INVALIDO: el participante ya pertenece a ese grupo'; end if;
    -- Solo mediciones aún pendientes
    select coalesce(array_agg(v), '{}') into vars from unnest(coalesce(p_variables, '{}')) v
     where not exists (select 1 from measurements m where m.participant_id = part.id and m.variable = v);
    if p_type <> 'traslado' and cardinality(vars) = 0 then
      raise exception 'SIN_PENDIENTES: las mediciones seleccionadas ya están registradas; use «Volver a medir»';
    end if;
  end if;

  if exists (select 1 from support_requests where participant_id = part.id and status = 'pendiente') then
    raise exception 'DUPLICADA: ya existe una solicitud pendiente para este participante';
  end if;
  insert into support_requests(participant_id, type, reason, origin_group_id, target_group_id, variables, requested_by)
  values (part.id, p_type, trim(p_reason), part.group_id, target, vars, u.id)
  returning id into new_id;
  perform audit('solicitud_creada', 'support_request', new_id,
    jsonb_build_object('participant', part.number, 'type', p_type, 'target', target, 'variables', vars));
  return new_id;
end $$;

create or replace function save_measurement(
  p_participant_number int,
  p_variable variable,
  p_value numeric,
  p_confirm_unusual boolean default false,
  p_client_op_id uuid default null,
  p_recorded_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u profiles;
  part participants;
  rng plausibility_ranges;
  existing measurements;
  req_id uuid;
  redo support_requests;
  unusual boolean;
  new_id uuid;
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO: cuenta inactiva o inexistente'; end if;

  -- Idempotencia: si esta operación ya se aplicó, devolver el mismo resultado
  if p_client_op_id is not null then
    select * into existing from measurements where client_op_id = p_client_op_id;
    if found then
      return jsonb_build_object('status','ya_guardado','id',existing.id,'value',existing.value);
    end if;
  end if;

  select * into part from participants
   where campaign_id = active_campaign() and number = p_participant_number;
  if not found then raise exception 'NO_ENCONTRADO: participante % no registrado', p_participant_number; end if;

  if u.role in ('principal','admin') then
    if not has_perm('register_measurements') then
      raise exception 'NO_AUTORIZADO: su cuenta no tiene habilitado el registro de mediciones';
    end if;
  else
    if not (p_variable = any(station_variables(u.station))) then
      raise exception 'NO_AUTORIZADO: la variable % no corresponde a su estación', p_variable;
    end if;
    if part.group_id <> u.group_id then
      select r.id into req_id from support_requests r
       where r.participant_id = part.id and r.status = 'aprobada'
         and r.target_group_id = u.group_id
         and (r.type = 'traslado' or p_variable = any(r.variables))
       order by r.resolved_at desc limit 1;
      if req_id is null then
        raise exception 'NO_AUTORIZADO: el participante % pertenece a otro grupo y no hay apoyo aprobado para esta medición', part.number;
      end if;
    end if;
  end if;

  select * into rng from plausibility_ranges where variable = p_variable;
  if p_value is null or p_value <= 0 then raise exception 'VALOR_INVALIDO: debe ser un número positivo'; end if;
  if p_value < rng.hard_min or p_value > rng.hard_max then
    raise exception 'FUERA_DE_RANGO: % % está fuera del rango admisible (% – %)', p_value, rng.unit, rng.hard_min, rng.hard_max;
  end if;
  unusual := p_value < rng.warn_min or p_value > rng.warn_max;
  if unusual and not coalesce(p_confirm_unusual, false) then
    return jsonb_build_object('status','requiere_confirmacion','warn_min',rng.warn_min,'warn_max',rng.warn_max,'unit',rng.unit);
  end if;

  select * into existing from measurements where participant_id = part.id and variable = p_variable for update;
  if found then
    -- ¿Hay una re-medición autorizada para esta variable?
    select * into redo from support_requests r
     where r.participant_id = part.id and r.status = 'aprobada' and r.type = 'remedicion'
       and p_variable = any(r.variables) and not (p_variable = any(r.done_variables))
       and (u.role in ('principal','admin') or r.target_group_id = u.group_id)
     order by r.resolved_at desc limit 1
     for update;
    if not found then
      return jsonb_build_object('status','ya_existe','id',existing.id,'value',existing.value,
                                'evaluator_id',existing.evaluator_id);
    end if;

    update measurements set value = round(p_value, rng.decimals), is_unusual = unusual,
      evaluator_id = u.id, support_request_id = redo.id,
      client_op_id = coalesce(p_client_op_id, client_op_id),
      recorded_at = coalesce(p_recorded_at, now()), updated_at = now()
    where id = existing.id;

    perform audit('medicion_repetida', 'measurement', existing.id,
      jsonb_build_object('participant', part.number, 'variable', p_variable,
                         'old', existing.value, 'old_evaluator', existing.evaluator_id,
                         'new', p_value, 'unusual', unusual, 'support_request', redo.id));

    update support_requests set done_variables = done_variables || p_variable,
      status = case when (select bool_and(v = any(done_variables || p_variable)) from unnest(variables) v)
                    then 'finalizada'::request_status else status end
    where id = redo.id;

    return jsonb_build_object('status','guardado','id',existing.id,'unusual',unusual,'remedicion',true,
                              'old_value',existing.value);
  end if;

  insert into measurements(participant_id, variable, value, is_unusual, evaluator_id,
                           support_request_id, client_op_id, recorded_at)
  values (part.id, p_variable, round(p_value, rng.decimals), unusual, u.id,
          req_id, p_client_op_id, coalesce(p_recorded_at, now()))
  on conflict (participant_id, variable) do nothing
  returning id into new_id;

  if new_id is null then  -- carrera con otro dispositivo
    select * into existing from measurements where participant_id = part.id and variable = p_variable;
    return jsonb_build_object('status','ya_existe','id',existing.id,'value',existing.value,
                              'evaluator_id',existing.evaluator_id);
  end if;

  perform audit('medicion_registrada', 'measurement', new_id,
    jsonb_build_object('participant', part.number, 'variable', p_variable, 'value', p_value,
                       'unusual', unusual, 'support_request', req_id));

  -- Cerrar apoyos (no re-mediciones ni traslados) cuando todas sus mediciones estén completas
  update support_requests r set status = 'finalizada'
   where r.participant_id = part.id and r.status = 'aprobada'
     and r.type in ('apoyo_temporal', 'apoyo_varias')
     and not exists (select 1 from unnest(r.variables) v
                     where not exists (select 1 from measurements mm
                                       where mm.participant_id = part.id and mm.variable = v));

  return jsonb_build_object('status','guardado','id',new_id,'unusual',unusual);
end $$;

revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function audit(text, text, uuid, jsonb) from authenticated;
revoke execute on function next_number(uuid) from authenticated;

-- ===================== DATOS INICIALES =====================

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

select 'ANTROPNUTRI instalado' as resultado, (select count(*) from groups) as grupos, (select count(*) from profiles where role = 'principal') as principal;
