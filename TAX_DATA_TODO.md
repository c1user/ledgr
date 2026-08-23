# TAX_DATA_TODO — verificación contributiva con el contable

Este es el documento único para trabajar con un(a) contable/CPA. Tiene dos
partes con naturalezas distintas:

- **Parte I — Reglas de nómina (datos):** cada regla vive en la base de
  datos y se verifica DENTRO de la aplicación (Nómina → Reglas
  contributivas). La nómina en modo producción se bloquea hasta que un
  humano las verifique.
- **Parte II — IVU e informativas (lógica):** estos valores viven en el
  CÓDIGO, no en reglas. Las respuestas del contable regresan como cambios
  de código; cada ítem indica dónde vive la lógica para hacerlos.

---

## Parte I — Reglas de nómina (se verifican en la aplicación)

Toda regla contributiva de nómina en Abaco se siembra como un **placeholder
NO VERIFICADO**: valores que lucen plausibles y existen solo para poder
construir y demostrar el módulo en modo sandbox. **Ninguno es correcto
hasta que un humano lo reemplace con los valores de la fuente oficial y lo
marque VERIFICADO** en el admin de reglas (Nómina → Reglas contributivas).
La nómina en modo producción falla mientras cualquier regla que una corrida
usaría siga NO VERIFICADA; todo output de sandbox lleva la marca de agua
"CÁLCULO NO VERIFICADO — SOLO PRUEBAS".

Cómo completar un ítem:
1. Obtén el documento oficial vigente de la fuente indicada.
2. Edita el payload de la regla en el admin para que coincida exactamente;
   reemplaza la cita placeholder con el nombre y URL del documento.
3. Verifica la regla (solo el dueño) — esto registra tu certificación.
4. Repite cada enero con los valores del año nuevo (versión nueva, fechas
   de vigencia nuevas — nunca sobrescribas una versión verificada).

Las semillas viven en `backend/src/services/payrollRulesSeed.js`; esta
lista rastrea el trabajo humano, un ítem por tipo de regla sembrada.

---

- [ ] **Tablas de retención de ingreso PR** (`pr_income_tax_withholding`)
      — las tablas de retención patronal de Hacienda del año vigente.
      Fuente: hacienda.pr.gov → publicaciones SURI (Patronos/Retención).
      La forma de los tramos del placeholder es una conjetura; las tablas
      reales difieren estructuralmente — espera reestructurar el payload,
      no solo editar números.

- [ ] **Campos del Formulario 499 R-4** (`pr_499r4_fields`) — la lista
      exacta de campos del Certificado de Exención para la Retención
      vigente (opciones de estado de exención, concesiones, retención
      adicional, exenciones especiales). Fuente: Hacienda, revisión
      vigente del Formulario 499 R-4.

- [ ] **Planilla patronal federal para patronos de PR**
      (`federal_employment_return`) — qué planilla radican ahora los
      patronos de PR (el Formulario 941-PR fue descontinuado — confirmar
      el reemplazo y la opción en español) y las reglas del calendario de
      depósitos. Fuente: IRS (irs.gov) — instrucciones del formulario
      vigente.

- [ ] **Tasa y base salarial del Seguro Social** (`social_security`) —
      año vigente. Fuente: hoja COLA de la SSA (ssa.gov) / Publicación 15
      del IRS.

- [ ] **Tasas de Medicare y umbral del impuesto adicional** (`medicare`)
      — año vigente. Fuente: Publicación 15 del IRS.

- [ ] **Tasas y base del SINOT** (`sinot`) — participación del empleado y
      del patrono en el seguro por incapacidad no ocupacional. Fuente:
      Departamento del Trabajo (DTRH, trabajo.pr.gov).

- [ ] **SUTA: base, tasa de patrono nuevo, cargos** (`suta`) — más la
      tasa de experiencia de ESTE patrono según su notificación del DTRH
      (se entra como versión nueva de la regla). Fuente: DTRH.

- [ ] **Seguro Social Choferil** (`seguro_choferil`) — qué ocupaciones
      cubre y los montos semanales vigentes. Fuente: DTRH (Ley de Seguro
      Social Choferil).

- [ ] **Bono de Navidad** (`christmas_bonus`) — umbrales de horas por
      régimen de fecha de empleo, porcentajes y topes por tamaño del
      patrono, ventana de pago y el proceso de solicitud de exención.
      Fuente: DTRH, Ley 148 de 1969 según enmendada. NOTA: litigio
      reciente anuló una enmienda — confirmar qué texto rige hoy.

- [ ] **Horas extra y período de tomar alimentos** (`overtime`) —
      umbrales diarios y semanales, multiplicadores, penalidad del
      período de alimentos. Fuente: Ley 379 de 1948 según enmendada por
      la reforma laboral de 2017 (Ley 4-2017); confirmar estado vigente.

- [ ] **Acumulación de vacaciones/enfermedad** (`vacation_sick_accrual`)
      — tasas de acumulación por tamaño del patrono y fecha de empleo,
      horas mínimas mensuales. Fuente: texto vigente (régimen Ley
      180-1998 / Ley 4-2017), vía DTRH.

- [ ] **Bandas de tamaño del patrono** (`employer_size_bands`) — las
      definiciones de conteo de empleados que usan los estatutos de bono
      y acumulación, y el método de conteo. Fuente: DTRH / texto de la
      Ley 148.

- [ ] **Frecuencias de pago** (`pay_frequencies_allowed`) — requisitos
      estatutarios de frecuencia de pago; en particular, si el pago
      mensual es lícito para empleados no exentos. Fuente: DTRH.

- [ ] **Campos mínimos del talonario** (`paystub_fields_9017`) — la
      lista mínima exacta bajo el Reglamento 9017. Fuente: DTRH,
      Reglamento 9017.
      **2026-08-18: texto oficial obtenido y transcrito** — Reglamento
      9017 Art. XV (8 ítems, incluye "puesto"; talonarios electrónicos
      permitidos, disponibilidad en 5 días, correo electrónico como
      puerto seguro). PDF oficial:
      app.estado.gobierno.pr/ReglamentosOnLine/Reglamentos/9017.pdf
      (servidor solo HTTP). El payload sembrado y la plantilla del
      talonario ya se actualizaron; el VERIFY en el admin sigue siendo
      tuyo.

- [ ] **Calendario de depósitos de Hacienda**
      (`hacienda_deposit_schedule`) — frecuencias y umbrales de depósito
      de la retención de ingreso. Fuente: hacienda.pr.gov / guía patronal
      SURI.

- [ ] **Fechas de radicación trimestral** (`quarterly_filing_schedule`)
      — reconciliación de retención de Hacienda y fechas del informe
      trimestral de desempleo/SINOT del DTRH. Fuentes: Hacienda (SURI),
      DTRH.

- [ ] **Spec del archivo electrónico W-2PR** (`w2pr_file_spec`) — la
      especificación de radicación electrónica del 499R-2/W-2PR de
      Hacienda PARA EL AÑO A RADICAR (se publica anualmente; la versión
      del spec es parte de la regla). Fuente: publicación anual de
      Hacienda.
      **2026-08-18: spec TY2025 obtenido e implementado** — Publicación
      25-01 (Rev. 2025-09-23), formato EFW2PR, codificado como versión
      `EFW2PR-TY2025` en el builder (9 récords, pruebas con posiciones
      exactas). Antes de radicar en enero 2027: obtener la Publicación
      26-01 (sale sep–oct 2026), comparar, subir el spec_version de la
      regla y VERIFICAR. Huecos de datos que el builder advierte: no hay
      columna de teléfono del patrono, y los empleados necesitan
      dirección estructurada ciudad/estado/zip (ya añadida; complétala).

- [ ] **Declaración de la CFSE** (`cfse_declaration`) — formato de la
      declaración anual de nómina, período de la póliza, fecha límite, y
      las primas de ESTE patrono según su póliza. Fuente: CFSE
      (fondopr.com).

---

**Ritual anual (cada enero, antes de la primera corrida del año):**
vuelve a obtener cada ítem de arriba, carga los valores del año nuevo como
versiones nuevas efectivas el 1 de enero, verifícalas, y confirma que el
preflight de nómina pasa en modo producción. Las reglas son por negocio —
repite para cada patrono cliente al que le corras nómina.

---

## Parte II — IVU e informativas (verificación de lógica, no de reglas)

Estos valores viven en el **código**, no en reglas de la base de datos. El
contable los confirma contra las fuentes oficiales y, si algo difiere, la
corrección es un cambio de código (cada ítem dice dónde vive la lógica).
Los reportes correspondientes llevan avisos de "preparación — no es una
planilla radicada" precisamente porque estos valores esperan esta
verificación.

### IVU / SC 2915

- [ ] **Tasas del IVU:** 11.5% combinado = 10.5% estatal + 1% municipal
      en bienes y servicios tributables; 4% IVU especial en servicios
      designados y servicios B2B, SOLO estatal (sin porción municipal);
      y la heurística del app: una tasa combinada personalizada ≥ 5% se
      asume que incluye el 1% municipal, < 5% se trata como solo
      estatal. Fuente: Código de Rentas Internas Secs. 4020.01/4020.02 y
      guía SC 2915 (hacienda.pr.gov). Dónde vive:
      `backend/src/services/invoiceTotals.js` (defaultMuniRate) y
      `frontend/src/lib/ivu.js` (presets de la factura).

- [ ] **Qué servicios califican al 4%:** la lista de "servicios
      designados" y servicios B2B, y el relevo de agente no retenedor
      para proveedores con volumen ≤ $200,000 (Ley 257-2018, CC RI
      19-05) — es decir, cuándo un cliente debe usar el preset "4%
      servicios designados" y cuándo no debe cobrar el 4% en absoluto.
      Fuente: CC RI 19-05, hacienda.pr.gov. Dónde vive: es guía de uso
      (los presets existen; el app no decide por el usuario).

- [ ] **Vencimiento y canal de la SC 2915:** planilla y pago vencen el
      día 20 del mes siguiente, electrónico por SURI. Desde agosto 2026
      (Ley 72-2025) el 1% municipal también se radica por SURI en los 73
      municipios COFIM; **Bayamón, Carolina, Guaynabo, Mayagüez y San
      Juan** mantienen radicación municipal aparte. Confirmar que sigue
      así y que aplica a los municipios de tus clientes. Fuente:
      hacienda.pr.gov / SURI. Dónde vive: `generateIvuSchedule` en
      `backend/src/services/complianceSchedule.js` (día 20 fijo) y el
      texto del aviso en el reporte "IVU mensual".

- [ ] **Ventas exentas:** qué categorías van como exentas (alimentos no
      preparados, medicamentos recetados, etc.) — el app las registra
      con el preset "Exento" en la factura y las reporta en la columna
      de ventas exentas; confirmar el uso correcto por tipo de cliente.
      Fuente: Código de Rentas Internas / guía SC 2915.

- [ ] **Lo que el app NO modela — confirmar que ningún cliente lo
      necesita** (si alguno sí, se codifica):
      crédito de revendedor (Certificado de Revendedor), impuesto de uso
      sobre inventario importado (SC 2915D, vence el 10), exención de
      servicios de comerciantes con volumen ≤ $50,000, Certificado de
      Compras Exentas, y desglose por municipio para negocios con
      localidades en más de un municipio.

- [ ] **Registro de Comerciante:** número por localidad (formato
      7+4, p. ej. 1234567-8901), aparece en la SC 2915 y en las
      facturas; confirmar el ciclo de renovación (¿cada 2 años?) y si
      algún cliente necesita múltiples localidades — el app guarda UN
      número por negocio hoy. Dónde vive:
      `businesses.merchant_registration_number` (Perfil del negocio).

### Retención §1062.03 y 480.6SP

- [ ] **Tasa de retención en pagos por servicios:** el app deja entrar
      el monto retenido manualmente en cada transacción pero NO calcula
      el porcentaje. Confirmar la práctica correcta (la tasa estándar
      del 10%, cuándo un relevo la reduce o elimina) y decidir si el
      app debería calcularla. Fuente: Sec. 1062.03 del Código; cartas
      circulares de relevos. Dónde vive: el campo de retención en el
      modal de transacción (`transactionPosting.js`).

- [ ] **Umbral de la informativa 480.6SP:** $500 anuales por proveedor
      de servicios. Fuente: instrucciones del Formulario 480.6SP. Dónde
      vive: `THRESHOLD_480SP` en `backend/src/routes/reports.js`.

- [ ] **Códigos de exención A–L del 480.6SP:** existen en el spec
      (Exhibit J, posiciones 389-390) pero el app no los modela —
      confirmar que ningún proveedor de tus clientes los requiere.
      Fuente: Publicación 25-03 / instrucciones del 480.6SP.

- [ ] **Re-spec anual de la Publicación 25-03:** el archivo SURI del
      480.6SP está implementado contra la Pub 25-03 v2.0 (Rev.
      2026-04-28, TY2025) con posiciones verificadas contra el PDF
      oficial. Cada otoño sale la versión del año nuevo — comparar antes
      de radicar. Dónde vive: `backend/src/services/suriFile.js`.

### Informativas federales

- [ ] **Umbral del 1099-NEC:** $600 anuales (federal). Fuente:
      instrucciones IRS del 1099-NEC. Dónde vive: `THRESHOLD_1099` en
      `backend/src/routes/reports.js`.

### W-2PR — conceptos no capturados

- [ ] **Confirmar que ningún cliente necesita estos conceptos** antes de
      una radicación real (el motor de nómina no los produce y el
      archivo EFW2PR los emite en cero, correctamente): comisiones,
      propinas, concesiones (allowances), planes CODA/retiro
      cualificado, códigos de salarios exentos A–J (Boxes 16/17/18,
      incluye el código E de empleados jóvenes ≤ $40,000 que requiere
      fecha de nacimiento), gastos reembolsados, aportaciones
      caritativas, fondo de retiro gubernamental, y costo de cubierta
      médica patronal. Si algún cliente los necesita, se modela primero.
      Dónde vive: `backend/src/services/w2prFile.js` (buildEfw2pr).

---

**Ritual anual de la Parte II (cada otoño):** obtener las publicaciones
del año nuevo (25-01 → 26-01 para W-2PR; 25-03 → 26-03 para informativas),
comparar contra lo implementado, y vigilar legislación que cambie las
tasas del IVU o la retención de servicios. A diferencia de la Parte I,
estos cambios los aplica el desarrollador en código.
