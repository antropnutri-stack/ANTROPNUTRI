-- ANTROPNUTRI · Repetir una medición ya registrada sin solicitud:
-- el nuevo valor reemplaza al anterior y la auditoría conserva ambos.
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
  unusual boolean;
  new_id uuid;
begin
  select * into u from profiles where id = auth.uid() and status = 'activa';
  if not found then raise exception 'NO_AUTORIZADO: cuenta inactiva o inexistente'; end if;

  -- Idempotencia (reenvíos sin conexión)
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
    update measurements set value = round(p_value, rng.decimals), is_unusual = unusual,
      evaluator_id = u.id, client_op_id = coalesce(p_client_op_id, client_op_id),
      recorded_at = coalesce(p_recorded_at, now()), updated_at = now()
    where id = existing.id;
    perform audit('medicion_repetida', 'measurement', existing.id,
      jsonb_build_object('participant', part.number, 'variable', p_variable,
                         'old', existing.value, 'old_evaluator', existing.evaluator_id, 'new', p_value));
    return jsonb_build_object('status','guardado','id',existing.id,'remedicion',true,'old_value',existing.value);
  end if;

  insert into measurements(participant_id, variable, value, is_unusual, evaluator_id, client_op_id, recorded_at)
  values (part.id, p_variable, round(p_value, rng.decimals), unusual, u.id,
          p_client_op_id, coalesce(p_recorded_at, now()))
  on conflict (participant_id, variable) do update
    set value = excluded.value, evaluator_id = excluded.evaluator_id, updated_at = now()
  returning id into new_id;

  perform audit('medicion_registrada', 'measurement', new_id,
    jsonb_build_object('participant', part.number, 'variable', p_variable, 'value', p_value));

  return jsonb_build_object('status','guardado','id',new_id,'unusual',unusual);
end $$;

revoke execute on function save_measurement(int, variable, numeric, boolean, uuid, timestamptz) from anon, public;
grant execute on function save_measurement(int, variable, numeric, boolean, uuid, timestamptz) to authenticated;
