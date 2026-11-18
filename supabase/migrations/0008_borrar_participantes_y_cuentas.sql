-- ANTROPNUTRI · Administradores pueden borrar participantes y cuentas.
-- Al borrar una cuenta, sus mediciones y registros se conservan (responsable = vacío).

alter table measurements alter column evaluator_id drop not null;
alter table support_requests alter column requested_by drop not null;

alter table measurements drop constraint if exists measurements_evaluator_id_fkey;
alter table measurements add constraint measurements_evaluator_id_fkey
  foreign key (evaluator_id) references profiles(id) on delete set null;
alter table audit_log drop constraint if exists audit_log_actor_id_fkey;
alter table audit_log add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;
alter table participants drop constraint if exists participants_created_by_fkey;
alter table participants add constraint participants_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table support_requests drop constraint if exists support_requests_requested_by_fkey;
alter table support_requests add constraint support_requests_requested_by_fkey
  foreign key (requested_by) references profiles(id) on delete set null;
alter table support_requests drop constraint if exists support_requests_resolved_by_fkey;
alter table support_requests add constraint support_requests_resolved_by_fkey
  foreign key (resolved_by) references profiles(id) on delete set null;

-- Borrar participante (y sus mediciones). Queda una copia en la auditoría.
create or replace function delete_participant(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare old participants; ms jsonb;
begin
  if not is_admin() then raise exception 'NO_AUTORIZADO: solo administradores'; end if;
  select * into old from participants where id = p_id for update;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  select coalesce(jsonb_object_agg(variable, value), '{}') into ms from measurements where participant_id = p_id;
  delete from participants where id = p_id;
  perform audit('participante_eliminado', 'participant', p_id,
    jsonb_build_object('number', old.number, 'full_name', old.full_name, 'dni', old.dni, 'mediciones', ms, 'reason', p_reason));
end $$;

revoke execute on function delete_participant(uuid, text) from anon, public;
grant execute on function delete_participant(uuid, text) to authenticated;
