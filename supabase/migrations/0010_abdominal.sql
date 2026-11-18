-- ANTROPNUTRI · Perímetro abdominal: rango (sin restricción) y vista de resultados con 10 medidas
insert into plausibility_ranges values ('perimetro_abdominal', 'cm', 0.1, 999, 0.1, 999, 1)
on conflict (variable) do nothing;

drop view if exists participant_results;
create view participant_results with (security_invoker = true) as
with m as (
  select participant_id,
    max(value) filter (where variable = 'peso') as peso,
    max(value) filter (where variable = 'talla') as talla,
    max(value) filter (where variable = 'cintura') as cintura,
    max(value) filter (where variable = 'perimetro_abdominal') as perimetro_abdominal,
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
    m.peso, m.talla, m.cintura, m.perimetro_abdominal, m.perimetro_braquial, m.cadera,
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
    when b.n_measurements < 10 then 'en_proceso'
    else 'completo' end as estado
from base b;

