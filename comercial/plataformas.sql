-- ============================================================
-- PLATAFORMAS · tablas para el historial de Bionexo
-- ------------------------------------------------------------
-- Correr en el panel de Supabase de EyG (SQL Editor).
-- El módulo comercial/plataformas.html hoy trae los datos embebidos;
-- cuando estas tablas existan y tengan datos, se cambia UNA función
-- (leerDatos) y el resto del módulo sigue igual.
--
-- Por qué dos tablas: la cabecera se levanta rápido (13 páginas del
-- índice) y el detalle renglón por renglón se recolecta DESPACIO, de a
-- pedidos, porque Bionexo frena si se le piden muchas páginas seguidas.
-- La bandera detalle_leido marca cuáles ya se bajaron, así el recolector
-- sabe dónde retomar y nunca repite trabajo.
-- ============================================================

create table if not exists public.bionexo_cotizaciones (
  id              text primary key,              -- ID de la cotización en Bionexo
  cliente         text not null,
  cuit            text,
  titulo          text,
  tipo            text,                          -- Cotización Normal / de urgencia / PDC
  vence           timestamptz,
  estado          text,                          -- Pendente / Cerrada / Pedido Confirmado
  renglones       int           default 0,       -- cuántos productos pidieron
  cotizados       int           default 0,       -- a cuántos les pusimos precio
  ganados         int           default 0,       -- cuántos salieron Confirmado
  rechazados      int           default 0,
  monto_cotizado  numeric(16,2) default 0,
  monto_ganado    numeric(16,2) default 0,
  detalle_leido   boolean       default false,   -- ¿ya se bajó renglón por renglón?
  leido_en        timestamptz,
  creado_en       timestamptz   default now()
);

create table if not exists public.bionexo_renglones (
  cotizacion_id   text not null references public.bionexo_cotizaciones(id) on delete cascade,
  seq             int  not null,                 -- orden dentro del pedido
  cod_bionexo     text,                          -- código del producto en Bionexo (estable, se repite mes a mes)
  producto        text,                          -- lo que pidió el hospital
  marca_pedida    text,                          -- "Acepto alternativas" = margen a favor
  cantidad        numeric(16,2),
  cod_eyg         text,                          -- el [15346] del detalle: el puente con Odoo
  producto_eyg    text,                          -- lo que ofrecimos
  precio          numeric(16,4),                 -- precio unitario cotizado
  marca           text,
  presentacion    text,
  estado          text,                          -- Confirmado / Rechazado / Pendiente / Cancelado
  primary key (cotizacion_id, seq)
);

-- Para el ranking de productos (los que siempre ganamos y los que siempre perdemos)
create index if not exists ix_bxr_cod      on public.bionexo_renglones (cod_bionexo);
create index if not exists ix_bxr_eyg      on public.bionexo_renglones (cod_eyg) where cod_eyg is not null;
create index if not exists ix_bxr_estado   on public.bionexo_renglones (estado);
-- Para la evolución mensual y el ranking de clientes
create index if not exists ix_bxc_vence    on public.bionexo_cotizaciones (vence);
create index if not exists ix_bxc_cliente  on public.bionexo_cotizaciones (cliente);
-- Para que el recolector sepa qué le falta
create index if not exists ix_bxc_pend     on public.bionexo_cotizaciones (detalle_leido) where detalle_leido = false;

-- RLS: lee cualquier usuario logueado del Core; escribe SOLO el recolector
-- (service_role). Nadie edita estos números a mano: son el espejo de Bionexo.
alter table public.bionexo_cotizaciones enable row level security;
alter table public.bionexo_renglones    enable row level security;

drop policy if exists bxc_lectura on public.bionexo_cotizaciones;
create policy bxc_lectura on public.bionexo_cotizaciones
  for select to authenticated using (true);

drop policy if exists bxr_lectura on public.bionexo_renglones;
create policy bxr_lectura on public.bionexo_renglones
  for select to authenticated using (true);

-- ============================================================
-- PORTADA SALUD · lo que ya se resolvió, para el próximo pedido
-- ------------------------------------------------------------
-- Portada se cotiza con su planilla (comercial/cotizar-plataforma.html).
-- Cada vez que la comercial descarga la planilla completa, se guarda acá
-- qué producto de EyG eligió para cada código del comprador y por cuánto
-- dividió (el precio de Portada es por unidad, el de Odoo por envase).
-- El próximo pedido con ese código lo propone primero. Es una sugerencia:
-- el precio se vuelve a leer siempre de la tarifa.
-- ============================================================

create table if not exists public.plataforma_equivalencias (
  plataforma          text not null,              -- 'portada' (después, otras)
  cod_comprador       text not null,              -- el «V 100416» de la columna INTERNO
  cod_externo         text,                       -- la columna EXTERNO
  producto_comprador  text,                       -- cómo lo pidieron
  cod_eyg             text not null,              -- default_code de Odoo
  producto_eyg        text,
  divisor             int,                        -- unidades por envase usadas
  ultimo_pedido       text,
  actualizado_en      timestamptz default now(),
  actualizado_por     uuid default auth.uid(),
  primary key (plataforma, cod_comprador)
);

-- La escriben las comerciales desde la pantalla: cualquier usuario logueado
-- lee y guarda (no hay plata en juego, solo la sugerencia del producto).
alter table public.plataforma_equivalencias enable row level security;

drop policy if exists peq_lectura on public.plataforma_equivalencias;
create policy peq_lectura on public.plataforma_equivalencias
  for select to authenticated using (true);

drop policy if exists peq_alta on public.plataforma_equivalencias;
create policy peq_alta on public.plataforma_equivalencias
  for insert to authenticated with check (true);

drop policy if exists peq_cambio on public.plataforma_equivalencias;
create policy peq_cambio on public.plataforma_equivalencias
  for update to authenticated using (true) with check (true);
