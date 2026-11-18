-- ANTROPNUTRI v2
--  * 9 mediciones (peso, talla, cintura, bíceps, cadera y 4 pliegues)
--  * Participantes con DNI, edad y promoción (JUSTICIEROS / AGUERRIDOS = grupos)
--  * Cualquier evaluador puede registrar cualquier medición de cualquier participante
--  * Numeración única compartida entre promociones

-- Rangos de plausibilidad de las nuevas variables
insert into plausibility_ranges values
  ('cadera',               'cm', 50, 200, 75, 130, 1),
  ('pliegue_subescapular', 'mm', 2,  70,  5,  45,  1),
  ('pliegue_suprailiaco',  'mm', 2,  70,  4,  45,  1),
  ('pliegue_bicipital',    'mm', 1,  50,  2,  30,  1)
on conflict (variable) do nothing;

-- Participantes: DNI, sexo opcional
alter table participants add column if not exists dni text;
alter table participants alter column sex drop not null;
alter table participants drop constraint if exists participants_dni_check;
alter table participants add constraint participants_dni_check check (dni is null or dni ~ '^[0-9]{8}$');
create unique index if not exists participants_dni_unique on participants (campaign_id, dni) where dni is not null;

-- Todas las variables para cualquier estación (las estaciones ya no restringen)
create or replace function station_variables(s station) returns variable[]
language sql immutable set search_path = public as $$
  select enum_range(null::variable)
$$;

-- Cualquier cuenta activa ve a todos los participantes
create or replace function can_see_participant(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'activa')
$$;

-- Vista de resultados con las 9 mediciones e indicadores
drop view if exists participant_results;
create view participant_results with (security_invoker = true) as
with m as (
  select participant_id,
    max(value) filter (where variable = 'peso') as peso,
    max(value) filter (where variable = 'talla') as talla,
    max(value) filter (where variable = 'cintura') as cintura,
    max(value) filter (where variable = 'perimetro_braquial') as perimetro_braquial,
    max(value) filter (where variable = 'cadera') as cadera,
    max(value) filter (where variable = 'pliegue_tricipital') as pliegue_tricipital,
    max(value) filter (where variable = 'pliegue_subescapular') as pliegue_subescapular,
    max(value) filter (where variable = 'pliegue_suprailiaco') as pliegue_suprailiaco,
    max(value) filter (where variable = 'pliegue_bicipital') as pliegue_bicipital,
    count(*) as n_measurements,
    bool_or(is_unusual) as any_unusual
  from measurements group by participant_id
), base as (
  select p.id, p.campaign_id, p.number, p.full_name, p.dni, p.sex, p.birth_date,
    coalesce(p.age, extract(year from age(c.event_date, p.birth_date))::int) as age,
    p.group_id, g.code as group_code, p.needs_review, p.review_note, c.event_date,
    m.peso, m.talla, m.cintura, m.perimetro_braquial, m.cadera,
    m.pliegue_tricipital, m.pliegue_subescapular, m.pliegue_suprailiaco, m.pliegue_bicipital,
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
  round(b.cintura / b.cadera, 3) as icc,
  round(b.perimetro_braquial - pi()::numeric * (b.pliegue_tricipital / 10.0), 1) as cmb,
  b.pliegue_tricipital + b.pliegue_subescapular + b.pliegue_suprailiaco + b.pliegue_bicipital as suma_pliegues,
  case
    when b.needs_review then 'requiere_revision'
    when b.n_measurements = 0 then 'sin_iniciar'
    when b.n_measurements < 9 then 'en_proceso'
    else 'completo' end as estado
from base b;

-- Registrar medición: sin restricción de estación ni de grupo
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
  redo support_requests;
  unusual boolean;
  new_id uuid;
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO: cuenta inactiva o inexistente'; end if;

  if p_client_op_id is not null then
    select * into existing from measurements where client_op_id = p_client_op_id;
    if found then
      return jsonb_build_object('status','ya_guardado','id',existing.id,'value',existing.value);
    end if;
  end if;

  select * into part from participants
   where campaign_id = active_campaign() and number = p_participant_number;
  if not found then raise exception 'NO_ENCONTRADO: participante % no registrado', p_participant_number; end if;

  if u.role in ('principal','admin') and not has_perm('register_measurements') then
    raise exception 'NO_AUTORIZADO: su cuenta no tiene habilitado el registro de mediciones';
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
    select * into redo from support_requests r
     where r.participant_id = part.id and r.status = 'aprobada' and r.type = 'remedicion'
       and p_variable = any(r.variables) and not (p_variable = any(r.done_variables))
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

  insert into measurements(participant_id, variable, value, is_unusual, evaluator_id, client_op_id, recorded_at)
  values (part.id, p_variable, round(p_value, rng.decimals), unusual, u.id,
          p_client_op_id, coalesce(p_recorded_at, now()))
  on conflict (participant_id, variable) do nothing
  returning id into new_id;

  if new_id is null then
    select * into existing from measurements where participant_id = part.id and variable = p_variable;
    return jsonb_build_object('status','ya_existe','id',existing.id,'value',existing.value,
                              'evaluator_id',existing.evaluator_id);
  end if;

  perform audit('medicion_registrada', 'measurement', new_id,
    jsonb_build_object('participant', part.number, 'variable', p_variable, 'value', p_value, 'unusual', unusual));

  return jsonb_build_object('status','guardado','id',new_id,'unusual',unusual);
end $$;

-- Registro de participante: nombres, DNI, edad, promoción (cualquier cuenta activa)
drop function if exists register_participant(text, sex, date, int, uuid, int, boolean);
create or replace function register_participant(
  p_full_name text, p_dni text, p_age int, p_group_id uuid,
  p_sex sex default null, p_birth_date date default null, p_number int default null, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles; camp uuid := active_campaign(); n int; new_id uuid; dup record; d text := nullif(trim(p_dni), '');
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  if camp is null then raise exception 'SIN_CAMPAÑA: no hay campaña activa'; end if;
  if p_group_id is null or not exists (select 1 from groups where id = p_group_id and campaign_id = camp) then
    raise exception 'PROMOCION_REQUERIDA: seleccione la promoción';
  end if;
  if p_full_name is null or length(trim(p_full_name)) < 3 then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_age is null and p_birth_date is null then raise exception 'EDAD_REQUERIDA: indique la edad'; end if;
  if d is not null and d !~ '^[0-9]{8}$' then raise exception 'DNI_INVALIDO: el DNI debe tener 8 dígitos'; end if;

  if d is not null then
    select number, full_name into dup from participants where campaign_id = camp and dni = d;
    if found then raise exception 'DNI_DUPLICADO: el DNI % ya está registrado como participante %', d, lpad(dup.number::text, 3, '0'); end if;
  end if;
  if not coalesce(p_force, false) then
    select number, full_name into dup from participants
     where campaign_id = camp
       and lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_full_name), '\s+', ' ', 'g'))
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
    select coalesce(max(number), 0) + 1 into n from participants where campaign_id = camp;
  end if;

  insert into participants(campaign_id, number, full_name, dni, birth_date, age, sex, group_id, created_by)
  values (camp, n, regexp_replace(trim(p_full_name), '\s+', ' ', 'g'), d, p_birth_date, p_age, p_sex, p_group_id, u.id)
  returning id into new_id;
  perform audit('participante_registrado', 'participant', new_id,
    jsonb_build_object('number', n, 'group', p_group_id, 'dni', d, 'modo', 'manual'));
  return jsonb_build_object('status','registrado','id',new_id,'number',n);
end $$;

-- Importación: {full_name, dni?, age?, birth_date?, sex?, group_code (promoción), number?}
create or replace function import_participants(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare camp uuid := active_campaign(); r jsonb; gid uuid; n int; inserted int := 0; errors jsonb := '[]'; idx int := 0;
begin
  if not has_perm('manage_participants') then raise exception 'NO_AUTORIZADO'; end if;
  if camp is null then raise exception 'SIN_CAMPAÑA'; end if;
  perform pg_advisory_xact_lock(hashtext('numbers:' || camp::text));
  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    begin
      gid := null;
      select id into gid from groups where campaign_id = camp and code = upper(trim(r->>'group_code'));
      if gid is null then raise exception 'promoción «%» no existe (use JUSTICIEROS o AGUERRIDOS)', r->>'group_code'; end if;
      n := nullif(r->>'number','')::int;
      if n is null then select coalesce(max(number), 0) + 1 into n from participants where campaign_id = camp; end if;
      insert into participants(campaign_id, number, full_name, dni, birth_date, age, sex, group_id, created_by)
      values (camp, n, regexp_replace(trim(r->>'full_name'), '\s+', ' ', 'g'), nullif(trim(r->>'dni'), ''),
              nullif(r->>'birth_date','')::date, nullif(r->>'age','')::int,
              nullif(upper(r->>'sex'), '')::sex, gid, auth.uid());
      inserted := inserted + 1;
    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'error', sqlerrm, 'data', r);
    end;
  end loop;
  perform audit('participantes_importados', 'participant', null,
    jsonb_build_object('insertados', inserted, 'errores', jsonb_array_length(errors)));
  return jsonb_build_object('inserted', inserted, 'errors', errors);
end $$;

drop function if exists update_participant(uuid, text, sex, date, int, text);
create or replace function update_participant(p_id uuid, p_full_name text, p_dni text, p_age int, p_sex sex, p_birth_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old participants;
begin
  if not has_perm('manage_participants') then raise exception 'NO_AUTORIZADO'; end if;
  select * into old from participants where id = p_id for update;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  update participants set full_name = p_full_name, dni = nullif(trim(p_dni), ''), age = p_age, sex = p_sex,
    birth_date = p_birth_date, updated_at = now() where id = p_id;
  perform audit('participante_corregido', 'participant', p_id,
    jsonb_build_object('antes', to_jsonb(old) - 'id' - 'campaign_id',
                       'despues', jsonb_build_object('full_name',p_full_name,'dni',p_dni,'age',p_age,'sex',p_sex),
                       'reason', p_reason));
end $$;

revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function audit(text, text, uuid, jsonb) from authenticated;
revoke execute on function next_number(uuid) from authenticated;
