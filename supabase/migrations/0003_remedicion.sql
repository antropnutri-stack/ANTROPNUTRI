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
