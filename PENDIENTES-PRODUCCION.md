# PENDIENTES — Camino a producción

**Fecha:** 17 de agosto de 2026 · **Rama:** `ABACOQ` (commit `32ecfdc`)
Generado a partir de una auditoría completa de ROADMAP.md, ROADMAP-V2 a V5, `TAX_DATA_TODO.md`, `PAYROLL_RUNBOOK.md`, el código fuente y las notas del proyecto.

**Dónde estamos:** todo el trabajo de código de los roadmaps V1–V3 y V5 está terminado y commiteado. La suite automatizada del backend pasa completa (106 pruebas, incluyendo todo el motor de nómina v2), y el lint y el build del frontend pasan. ROADMAP-V4 (lanzamiento multi-plataforma) está íntegramente pendiente: sus 37 casillas siguen sin marcar.

**Cómo leer este documento:** las secciones van en orden de trabajo. Primero lo necesario para **probar** la funcionalidad que ya existe (§1), luego funcionalidad que falta construir (§2), luego datos y decisiones que desbloquean la nómina real y el lanzamiento (§3), y al final lo que **solo** hace falta el día del despliegue a producción (§4).

---

## 1 · Pruebas de funcionalidad (hacer primero)

Todo esto se puede hacer **hoy, en local**, sin comprar nada ni desplegar nada.

### 1.1 Nómina v2 — prueba funcional end-to-end (en sandbox)

El último commit lo dice explícitamente: *"Pending Functionallity Test"*. Las 106 pruebas automatizadas pasan, pero nadie ha ejercitado el módulo a mano en la app corriendo. Recorrido completo en modo sandbox:

- [ ] Crear el perfil de nómina del patrono.
- [ ] Dar de alta empleados: verificar que el SSN se cifra, se muestra enmascarado y el "revelar" funciona.
- [ ] Registrar tiempo diario (incluyendo horas que crucen umbrales de overtime).
- [ ] Crear una corrida en borrador, revisar los cálculos línea por línea.
- [ ] Finalizar la corrida y luego **reversarla**.
- [ ] Confirmar que la marca de agua **"CÁLCULO NO VERIFICADO — SOLO PRUEBAS"** aparece en todas las pantallas y documentos.

### 1.2 Probar cada documento de salida de nómina

Cada uno necesita un vistazo humano (todos con la marca de agua de sandbox):

- [ ] Talonario de pago PDF (bilingüe, columnas YTD, impresión de la corrida completa).
- [ ] Impresión de cheques en papel pre-impreso real, calibrando los offsets X/Y por patrono.
- [ ] Informe de elegibilidad del Bono de Navidad.
- [ ] Hoja de reconciliación trimestral de Hacienda.
- [ ] Export trimestral de salarios para el DTRH.
- [ ] Archivo W-2PR + PDF borrador.
- [ ] Hoja de la declaración anual de la CFSE.

### 1.3 Admin de reglas contributivas, flujo VERIFY y cambio de modo

- [ ] Probar la UI de Nómina → Reglas contributivas: badges de estado, visor/editor de payload, citas de fuentes.
- [ ] Probar la acción VERIFY (solo owner): registra `verified_by/at` y la versión verificada queda inmutable.
- [ ] Probar el cambio sandbox → producción por patrono.
- [ ] Confirmar que en modo producción una corrida **falla en preflight listando cada regla UNVERIFIED** que usaría (`payrollRunV2.js`).

### 1.4 Posteo al ledger y acumuladores YTD (finalizar en modo producción)

Las corridas sandbox nunca tocan el ledger ni los acumuladores YTD, así que la ruta de finalización real jamás se ha ejercitado contra un ledger vivo:

- [ ] Con un negocio de prueba con reglas verificadas (aunque sea con datos ficticios marcados como verificados), finalizar una corrida en modo producción y verificar el asiento balanceado (gasto de salarios, retenciones por agencia, acumulaciones patronales, clearing de pago neto).
- [ ] Reversar y verificar los asientos de reversa y el decremento de los YTD.

### 1.5 Deuda de cobertura automatizada (las áreas viejas no tienen pruebas)

El módulo nuevo (nómina) tiene cultura de pruebas excelente; las superficies viejas que mueven dinero ya están cubiertas en su mayoría (2026-08-19 — la suite pasó de 106 a 193 pruebas):

- [x] **Facturación / IVU** — HECHO: `computeTotals` extraído a `services/invoiceTotals.js` con pruebas unitarias (identidad estatal+municipal, 500 casos aleatorios) + suite HTTP completa (crear/enviar/pagar/anular con verificación del asiento balanceado, inmutabilidad, totales nunca del cliente).
- [x] **Auth** — HECHO: suite HTTP (validaciones de registro, login, errores no reveladores, tokens adulterados, token de negocio cerrado, anti-enumeración en forgot-password).
- [x] **Harness de integración HTTP** — HECHO: `tests/helpers/http.mjs` arranca la app real (`src/app.js`, separado de `server.js`) en puerto efímero, registra un negocio desechable por el flujo real y lo purga por close-business. Los gates de plan se prueban como 403 reales y el scoping multi-negocio con un segundo negocio. Ya cazó 3 bugs reales el primer día.
- [x] **Ledger / asientos / remesas** — HECHO: suite HTTP de asientos manuales (balanceo, scoping, reversas) + remesa de IVU + trial balance cuadrando al final.
- [ ] **Reportes P&L / balance:** `reports.js` P&L y `reportPdf.js` siguen sin pruebas directas (el balance sheet se verifica indirectamente vía trial-balance en las suites HTTP). Pendiente menor.
- [x] **Frontend (parcial)** — presets IVU extraídos a `lib/ivu.js` con pruebas + la paridad en/es ahora es un test (`i18n/parity.test.js`). Falta cobertura de componentes.
- [ ] **E2E de navegador:** no hay Playwright/Cypress. Meta: 3–5 recorridos núcleo sobre la cuenta demo. (Las suites HTTP cubren ya la mayor parte del valor.)
- [ ] Cuando los datos contributivos reales estén cargados (§3.1), **reemplazar las expectativas de los golden-file tests** por números verificados por humanos (diseñado como cambio solo-de-datos).

### 1.6 Durante la beta (esperando feedback de testers)

- [ ] Presentación del efectivo en el catálogo de cuentas: la cuenta "Cash" en $0 junto a las cuentas gemelas se ve rara. Arreglo acordado: anidar con `parent_id` + renombrar a "Petty cash". Aparcado a propósito hasta oír a los testers.

---

## 2 · Funcionalidad que falta construir

### 2.1 Huecos contables descubiertos en la auditoría (nuevos — no estaban en ningún roadmap)

- [x] **Planilla mensual del IVU (SC 2915)** — HECHO 2026-08-18: pestaña "IVU mensual" en Informes (desglose estatal 10.5% / municipal 1% por factura vía migración 036, presets 11.5%/4%/exento en la factura, calendario con vencimientos el 20, export CSV, núm. de Registro de Comerciante en el perfil y en el PDF de factura). Verificado en navegador con la cuenta demo.
- [x] **Asientos manuales / registrar el pago del IVU** — HECHO 2026-08-18: página "Libro diario" con asientos manuales balanceados (owner/admin, `POST /api/ledger/journal`), reversas con pista de auditoría, y flujo guiado "Registrar pago de IVU" (débito IVU por pagar / crédito banco). Verificado end-to-end: asiento 201, reversa 201, trial balance cuadra.

### 2.2 Nómina — código que espera datos reales

- [x] **Implementar el spec real del archivo W-2PR** — HECHO 2026-08-18: se obtuvo la Publicación 25-01 de Hacienda (EFW2PR, TY2025) y se implementó como versión `EFW2PR-TY2025` (9 récords con posiciones exactas y pruebas). Queda tuyo: obtener la Pub 26-01 (sale sep–oct 2026), comparar, y VERIFICAR la regla antes de radicar en enero 2027. Los empleados ahora tienen dirección estructurada (ciudad/estado/zip) — complétala.
- [x] **Plantilla del talonario según Reg. 9017** — HECHO 2026-08-18: se obtuvo el texto oficial del Reglamento 9017 (Art. XV: 8 campos, incluye "puesto"); el talonario ahora rinde el puesto (campo nuevo en empleados) y la regla sembrada cita el texto oficial. VERIFY en el admin de reglas sigue siendo tuyo.
- [x] **Feed de notificaciones del calendario de cumplimiento** — HECHO 2026-08-18: scheduler in-process (arranque + cada 12h) que alimenta la campana con obligaciones próximas (≤7 días) y vencidas (≤45 días; el histórico se marca en silencio), solo owner/admin, categoría "compliance" con opt-out de email en Mi Cuenta. Cubre nómina e IVU.

### 2.3 Infraestructura de tareas programadas (cron)

- [x] **Scheduler in-process** — HECHO 2026-08-18 con el feed de cumplimiento (§2.2): `services/complianceNotifier.js` corre al arrancar y cada 12h. 
- [ ] **Generación automática de transacciones recurrentes:** sigue siendo pull-based (el frontend llama al endpoint). Engancharla al scheduler es trivial técnicamente pero es una decisión de producto — generaría asientos en los libros sin acción del usuario. Decidir y, si va, mover la lógica de `generate-due` al scheduler.

### 2.4 Facturación / Hacienda — limitaciones v1 documentadas

- [x] **480.6SP individuos vs entidades** — HECHO 2026-08-19: los suplidores ahora distinguen individuo (Seguro Social, cifrado write-only igual que empleados) vs entidad (EIN); el archivo SURI exporta con tipo de ID "2", nombre dividido en campos de individuo (posiciones 762/792) y las columnas de partidas 1/3, verificado contra la Pub 25-03 v2.0 oficial (descargada). La reconciliación 480.6SP.2 separa totales por tipo. Migración 039.
- [ ] **Remesa de retenciones solo "ledger-funded":** solo se puede registrar contra cuentas de efectivo del ledger. Hueco menor; ampliar si los usuarios lo piden.

### 2.5 Cobros — Stripe (la última gran feature antes de lanzar de verdad)

Hoy `/plans` es un selector instantáneo y gratis: cualquier dueño se auto-asigna Premium. No existe ni una línea de código de Stripe.

- [ ] Productos/precios en Stripe para los tres tiers (mensual + anual). Pregunta para CPA/abogado: IVU sobre SaaS en PR.
- [ ] Checkout alojado + portal del cliente; columnas `stripe_customer_id`/`subscription_id`/`status` en `businesses`.
- [ ] Webhooks que fijen `businesses.plan` (con período de gracia en pagos fallidos) — los gates de entitlements ya construidos hacen el resto solos.
- [ ] Flujo de trial (recomendado: 30 días de Premium al registrarse) y reemplazo del selector instantáneo.
- [ ] Emails de dunning (pago fallido / tarjeta por expirar).
- [ ] **Nota:** la tarjeta Premium anuncia "Bank sync (coming soon)" pero Plaid está diferido a post-lanzamiento — construirlo entonces o ajustar el copy antes de cobrar.

### 2.6 Plataformas adicionales (no bloquean el lanzamiento web)

- [ ] **Escritorio (Tauri) — Fase 4 completa de V4:** shell, diálogos nativos de guardar archivo, auto-update, firma de código Windows/macOS, instaladores + página /download, protocolo `abaco://`. No existe nada aún.
- [ ] **Móvil (Capacitor) — Fase 5 completa de V4:** wrap iOS/Android, auditoría UX móvil (tablas densas, modales, touch targets — la mitigación anti-rechazo de las tiendas), captura de recibos con cámara nativa, deep links, paquete de cumplimiento de tiendas (privacy labels, Data Safety, listados EN+ES), TestFlight / Play closed testing, sumisiones (esperar al menos un rechazo por tienda). No existe nada aún.
- [ ] Diferido post-lanzamiento a propósito: Plaid, IAP de Apple (según decisión §3.3), listados Microsoft/Mac App Store, sitio de marketing, push notifications.

---

## 3 · Datos contributivos y decisiones (desbloquean nómina real y lanzamiento)

### 3.1 Verificar las 18 reglas contributivas — EL bloqueador de la nómina real

Todas las reglas se sembraron como placeholders **UNVERIFIED**; la nómina en modo producción falla a propósito hasta que un humano verifique cada una en la UI de admin contra la fuente oficial (`TAX_DATA_TODO.md`, 0/18 marcadas):

**Hacienda (hacienda.pr.gov / SURI):**
- [ ] Tablas de retención de ingreso PR — *ojo: la estructura real difiere del placeholder; esperar reestructurar el JSONB, no solo editar números*.
- [ ] Lista de campos del Formulario 499 R-4 vigente.
- [ ] Calendario de depósitos de la retención.
- [ ] Fechas de radicación trimestral.
- [ ] Spec del archivo electrónico W-2PR del año a radicar (antes de la ventana de enero, no antes).

**Federal (IRS / SSA):**
- [ ] Qué planilla patronal federal radica PR ahora que el 941-PR fue descontinuado, y el calendario de depósitos.
- [ ] Tasa y base salarial del Seguro Social (una base incorrecta sobre/sub-retiene en silencio).
- [ ] Tasas de Medicare y umbral del impuesto adicional.

**DTRH (trabajo.pr.gov):**
- [ ] SINOT: tasas y base (parte empleado y patrono).
- [ ] SUTA: base, tasa de patrono nuevo, cargos — **más la tasa de experiencia de cada patrono** de su notificación del DTRH (ritual de enero por cliente).
- [ ] Seguro Social Choferil: ocupaciones cubiertas y montos semanales.
- [ ] Bono de Navidad: umbrales de horas por régimen de fecha de empleo, porcentajes y topes por tamaño — *ojo: litigio reciente anuló una enmienda a la Ley 148; confirmar con DTRH cuál texto rige*.
- [ ] Overtime y período de tomar alimentos (Ley 379 / reforma 2017).
- [ ] Acumulación de vacaciones/enfermedad por tamaño de patrono y fecha de empleo.
- [ ] Definiciones de bandas de tamaño de patrono (seleccionan qué porcentaje/tope de bono aplica).
- [ ] Frecuencias de pago lícitas — en particular si el pago **mensual** es legal para no-exentos.
- [ ] Lista mínima de campos del talonario según el Reglamento 9017.

**CFSE (fondopr.com):**
- [ ] Formato de la declaración anual, período de póliza, fecha límite — más las primas de la póliza de **cada patrono** (ritual de enero).

**Notas de proceso:**
- Las reglas son por negocio: la verificación completa **se repite por cada patrono cliente**.
- Tras verificar, correr el paso 6 del runbook: corrida borrador en modo producción que pase preflight con **cero bloqueos** — ese es el gate final.
- Luego, activar el modo producción de ese patrono (por defecto todos quedan en sandbox).

### 3.2 Decisiones de nómina (del dueño)

- [ ] ¿Quién verifica los datos contributivos — tú solo o con un CPA revisor ("4 ojos")? (V5 0.4)
- [ ] Poner el ritual de re-verificación de enero en un calendario real (medio día; la nómina de producción se detiene cada enero hasta hacerlo — por diseño).
- [ ] ¿Cobrar la nómina por empleado? Se decide junto con Stripe (V5 0.7).

### 3.3 Decisiones de producto (del dueño)

- [ ] Confirmar disponibilidad del nombre "Abaco" en ambas tiendas antes de fijar la marca.
- [ ] Precios reales de los tres tiers y política de trial.
- [ ] ¿Cuentas demo en producción? (Recomendación del roadmap: no; o una controlada con contraseña rotativa.)
- [ ] **Decisión IAP de Apple, tomarla ya:** ¿app iOS solo-inicio-de-sesión (suscripción se compra en web, evitando el 15–30% de Apple) o IAP nativo (semanas extra de trabajo)? Determina el alcance de las fases móviles.
- [ ] ¿Analytics? Si eliges una herramienta con cookies, se activa el requisito del banner de cookies que hoy no hace falta. Recomendado: opción sin cookies.

### 3.4 Cuentas de terceros (plazos largos — abrirlas temprano)

- [ ] **Dominio** (~$12/año). Todo lo demás lo referencia: SPF/DKIM, APP_URL, CORS, deep links, listados.
- [ ] **Hosting:** backend (Render/Railway/Fly/VPS) + Postgres administrado + host estático para el frontend ($0–25/mes al inicio).
- [ ] **Email transaccional** (SES/Postmark/Resend) + registros SPF/DKIM/DMARC en el DNS. Sin esto no llegan invitaciones, resets ni verificaciones.
- [ ] **Stripe:** crear y activar la cuenta (la verificación de identidad tarda días).
- [ ] **Apple Developer Program** ($99/año; también necesario para firmar/notarizar el build de macOS).
- [ ] **Google Play Console** ($25 único) — *el plazo más largo de todo el proyecto:* cuentas personales nuevas deben correr una prueba cerrada con ~12 testers por 14 días antes de poder publicar.
- [ ] **Firma de código Windows** (Azure Trusted Signing ~$10/mes) para que los instaladores no disparen SmartScreen.
- [ ] **Revisión legal** de Términos y Privacidad (existen borradores bilingües); al aprobarse, poner `DRAFT = false` en `frontend/src/pages/LegalPage.jsx:9`. Las tiendas exigen una URL de política de privacidad viva, así que esto también bloquea las sumisiones.
- [ ] **Buzón de soporte real** para `SUPPORT_EMAIL` (hoy placeholder), y decidir si habrá página de FAQ/docs y página de status (los enlaces del menú de ayuda se omitieron a propósito hasta que existan destinos).

---

## 4 · Solo para el despliegue a producción (hacer al final)

### 4.1 Bloqueadores críticos de despliegue (arreglar antes de cualquier deploy)

- [x] **DDL del ledger capturado** — HECHO 2026-08-23: `migrations/009a_ledger_core.sql` (captura verbatim vía pg_dump: las 3 tablas, la vista, el trigger diferido de balanceo, y `accounts.coa_account_id` que el diff de esquemas destapó). **Probado de verdad:** base de datos construida desde cero con las 40 migraciones y la suite completa (192/193, 1 skip por diseño) pasando contra el esquema prístino. `scripts/schema-diff.mjs` queda como herramienta anti-drift.
- [x] **Runner de migraciones real** — HECHO: `npm run migrate` aplica todo en orden con tabla `schema_migrations` (+ `--status`, `--baseline`); la base de dev quedó baselined (40 aplicadas, 0 pendientes).
- [x] **URL del API env-driven** — HECHO: `VITE_API_URL` (dev → localhost, prod → `/api` relativo) + `frontend/.env.example`.
- [ ] **Merge de `ABACOQ` a `main`:** main sigue atrás; CI/auto-deploy apuntarán a main. (Decisión de git tuya.)
- [x] **Seed de dev fuera de `migrations/`** — HECHO: movido a `scripts/dev-seed-transactions.sql`; el runner además solo acepta archivos `NNN_*.sql`.

### 4.2 Infraestructura de producción

- [ ] Provisionar Postgres de producción con SSL, correr migraciones, desplegar el API con secretos frescos (JWT_SECRET, ANTHROPIC_API_KEY, AWS, SMTP), apuntar `api.<dominio>`, verificar `/health`.
- [ ] **`PAYROLL_ENC_KEY`:** generar la clave de producción (cifra los SSN; perderla = perder todos los SSN para siempre), custodiarla igual que JWT_SECRET con copia fuera de la máquina, y añadirla al chequeo `REQUIRED_ENV` de `server.js` para que falle al arrancar y no en la primera nómina.
- [ ] Bucket S3 de producción separado de dev, ACLs privadas, reglas de ciclo de vida, usuario IAM limitado a ese bucket.
- [ ] **Backups automáticos diarios + al menos un restore probado** — innegociable antes de que existan libros reales.
- [ ] Monitoreo: Sentry en backend + frontend, logging estructurado de requests, monitor de uptime sobre `/health`. Hoy no existe nada.
- [ ] **CI:** GitHub Actions corriendo la suite del backend + lint/build del frontend en cada push (con un Postgres desechable para las pruebas de DB), auto-deploy en main. Hoy el único gate es el hook local opt-in.

### 4.3 Pase de seguridad para exposición real

- [x] **`trust proxy`** — HECHO 2026-08-23: env `TRUST_PROXY` (número de saltos) en `app.js`; documentado en `.env.example`. `PAYROLL_ENC_KEY` ahora es requerido al arrancar (falla rápido, no en la primera nómina).
- [ ] Re-verificar helmet/CSP contra el dominio real; sanity-check de los rate limits con tráfico real.
- [x] **`npm audit` limpio** — HECHO 2026-08-23: 0 vulnerabilidades en backend y frontend (`npm audit fix`, sin bumps rompientes; suites y builds verdes). Queda tuyo al desplegar: **rotar todo secreto que haya vivido en dev** (JWT_SECRET, llaves AWS, ANTHROPIC_API_KEY).
- [ ] Política de seeds/demo en producción: sin cuentas demo (o una controlada), y desactivar todo lo dev-only.

### 4.4 Verificación en producción y lanzamiento

- [ ] Desplegar el frontend bajo el dominio real y verificar el ciclo completo de email **en producción**: registro → verificación → invitación → reset, aterrizando en inbox (no spam).
- [ ] Verificar la PWA sobre HTTPS en el dominio real: manifest, service worker, instalable en desktop y Android.
- [ ] Soft-launch: mover el grupo de testers a la infraestructura de producción.
- [ ] **Checklist de lanzamiento:** flags DRAFT apagados, datos demo fuera, backups verificados, alertas llegando a un buzón monitoreado, soporte atendido, decisión de status page tomada.
- [ ] Ritmo post-lanzamiento: actualizaciones de dependencias semanales, un simulacro de restore de DB, revisión de errores en Sentry.

---

## Ruta crítica sugerida

1. **Ya, en local:** pruebas funcionales de nómina (§1.1–1.4) y los dos huecos del IVU (§2.1) — los testers con libros reales los van a chocar.
2. **En paralelo, esta semana:** abrir las cuentas de plazo largo (§3.4) — dominio, Google Play (14 días), Apple, Stripe — aunque no se usen todavía.
3. **Antes de cualquier deploy:** migraciones + config (§4.1).
4. **Después:** infra + lanzamiento web (§4.2–4.4), Stripe para cobrar (§2.5).
5. **Para nómina real:** verificación contributiva completa (§3.1) — independiente del resto, puede avanzar cuando quieras.
6. **Al final:** escritorio y móvil (§2.6).
