# ANTROPNUTRI

Sistema web de evaluación antropométrica masiva: registro simultáneo por estaciones, ficha única por participante, solicitudes de apoyo con autorización, supervisión en tiempo real y exportación a Excel.

**Stack:** React 19 + TypeScript + Vite · Supabase (PostgreSQL, Auth, Realtime, Edge Functions) · ExcelJS.

## Puesta en marcha

### 1. Proyecto Supabase

1. Cree un proyecto en [supabase.com](https://supabase.com) (región más cercana: São Paulo).
2. En **SQL Editor**, ejecute `supabase/migrations/0001_init.sql`.
3. En **Authentication → Users → Add user**, cree el usuario principal con el correo `adm-001@antropnutri.local`, una contraseña segura y la opción *Auto Confirm User*.
4. En **SQL Editor**, ejecute `supabase/seed.sql` (crea la campaña activa, los grupos A–E con rangos 001–500 y el perfil principal).
5. En **Authentication → Providers → Email**, desactive *Allow new users to sign up* (las cuentas solo las crea la administración).
6. Despliegue la función que crea cuentas:

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase link --project-ref <ref-del-proyecto>
   ```

   ```bash
   npx supabase functions deploy admin-users
   ```

### 2. Aplicación web

```bash
cp .env.example .env.local
```

Complete `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Settings → API) y luego:

```bash
npm install
```

```bash
npm run dev
```

Para publicar: `npm run build` y suba `dist/` a cualquier hosting estático con HTTPS (Vercel, Netlify, Cloudflare Pages). Configure la reescritura de rutas a `index.html`.

### 3. Primer ingreso

Ingrese con el código `ADM-001`. Los códigos de acceso (`EVA-001`, `ADM-002`…) se convierten internamente en `codigo@antropnutri.local`; nadie necesita correo real.

## Cómo funciona

| Rol | Qué ve |
| --- | --- |
| **Evaluador** | Pantalla de su estación: número del participante → valores → **Guardar y siguiente**. Solo ve a los participantes de su grupo (y a los de otro grupo cuando hay un apoyo aprobado). La estación de **Registro** inscribe participantes y asigna número; **Supervisión** puede registrar cualquier medición del grupo y marcar «requiere revisión». |
| **Administrador** | Panel general, participantes, solicitudes, calidad; además, según sus permisos: importar, usuarios, exportar, auditoría y registro de mediciones. |
| **Principal** | Todo, más crear administradores, asignar permisos (incluido quién es autorizador), rangos de plausibilidad, grupos y campañas. |

Reglas que aplica la base de datos (no solo la interfaz):

- Toda escritura pasa por funciones SQL que verifican permisos; RLS impide escribir directamente en las tablas.
- Un valor final por participante y variable; nunca se sobrescribe en silencio (las correcciones requieren permiso y motivo, y quedan en auditoría).
- Rango **admisible** (se rechaza) y rango **habitual** (se pide confirmación y se marca «inusual»); ambos configurables.
- Las solicitudes se resuelven una sola vez: la primera persona autorizada que decide gana, las demás reciben «ya resuelta».
- El apoyo temporal se cierra solo al completarse las mediciones autorizadas; el traslado cambia el grupo y conserva el número.
- Sin conexión, las mediciones quedan en el dispositivo con un identificador único y se reenvían al volver la red sin duplicarse. La barra superior muestra **Sincronizado / pendientes / con error**.

Indicadores calculados: IMC con clasificación para adultos, relación cintura/talla y CMB estimada (`PB − π·PCT/10`). No se calcula porcentaje de grasa.

## Pruebas

```bash
npm test
```

Prueba las fórmulas (IMC, RCT, CMB, edad).

```bash
tests/sql/run.sh
```

Levanta un PostgreSQL temporal (requiere PostgreSQL 16 instalado localmente), aplica el esquema y comprueba 39 reglas: permisos por estación y grupo, RLS, duplicados, rangos, idempotencia, flujo completo de solicitudes, traslado, indicadores, auditoría e importación.

## Pendiente antes de la jornada

- **Validar los rangos de plausibilidad** (Configuración): los valores iniciales son orientativos para jóvenes de 18 a 24 años y deben ajustarse al protocolo.
- **Protocolo de medición:** la app recibe solo el valor final; el criterio (promedio, mediana…) debe definirse en el manual.
- **Criterio de interpretación de la RCT:** hoy se muestra el valor sin clasificar.
- **Prueba piloto** con varios dispositivos y usuarios simultáneos, incluida la recuperación sin conexión en celulares reales.
- **Consentimiento informado y tratamiento de datos** conforme a la Ley N.º 29733 y su reglamento.
- **Diseño definitivo de la mascota** (`src/components/Mascot.tsx` es un boceto provisional).
- Suspender o desactivar una cuenta bloquea de inmediato su acceso a los datos (RLS), aunque la sesión siga abierta en el dispositivo.
