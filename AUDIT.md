# API Analyser — Architecture and Product Audit

> Fase de análisis. No se modificó código de producción durante esta auditoría.
> Convenciones: **[C]** confirmado en código · **[I]** inferido del código · **[R]** recomendación · **[?]** no verificable sin ejecutar el sistema.

---

## 1. Executive Summary

**Estado general.** API Analyser tiene un núcleo técnico mejor de lo que sugiere su superficie. El motor de escaneo, la resolución de plugins y el aislamiento multi-tenant están bien resueltos. El producto falla en la **capa de dominio**: el modelo de datos no sabe qué es una vulnerabilidad persistente, solo qué es un hallazgo dentro de un escaneo. Eso invalida el triaje, impide la comparación entre escaneos y contamina todas las métricas.

**Fortalezas confirmadas.**
- **[C]** La selección de plugins se congela en `resolvedPlugins` al encolar y el worker se niega explícitamente a caer en «todos» si la selección es inválida (`scanner.processor.ts:69-90`). El frontend y el backend ejecutan lo mismo.
- **[C]** Aislamiento por usuario correcto y consistente: cada consulta de findings atraviesa `assessment.project.userId` (`findings.service.ts`). `updateStatus` verifica propiedad antes de escribir — sin IDOR.
- **[C]** La IA escribe **solo** en `aiAnalysis` / `aiSummary` (`ai.service.ts:82,162`). Nunca toca `severity`, `evidence` ni `status`. La separación entre evidencia del scanner y enriquecimiento de IA es arquitectónicamente correcta.
- **[C]** Las API keys de proveedores de IA se cifran con `createCipheriv` (`ai-config.service.ts:159-166`).

**Problemas principales.**
1. **[C]** No existe identidad de vulnerabilidad. Sin fingerprint, sin `firstSeenAt` / `lastSeenAt` / `resolvedAt`. El mismo fallo de CORS en 5 escaneos son 5 registros sin relación.
2. **[C]** El triaje se destruye. `status` y `notes` viven en el `Finding` de un assessment concreto, y `Finding` cuelga de `Assessment` con `onDelete: Cascade`. Borrar un escaneo borra el trabajo de clasificación.
3. **[C]** El score global no mide lo que dice medir (§7).
4. **[C]** Finance es una interfaz sin backend: `GET /api/v1/finance/summary` → **404** verificado en vivo.
5. **[C]** El esquema Prisma no declara **ni un solo `@@index`**.

**Riesgos más importantes.**
- **[C] Critical** — `ENCRYPTION_KEY` tiene fallback en el repositorio: `'fallback-encryption-key-32chars'` (`configuration.ts:22`). Sin la variable de entorno, los secretos se cifran con una clave pública.
- **[C] High** — El esquema anota `// encrypted` en `AuthConfig.token/password/apiKey/clientSecret`, pero no se encontró llamada de cifrado en la ruta de escritura (`projects.service.ts:291`). Comentario y código parecen contradecirse.

**Cambios estructurales recomendados.** Introducir `SecurityIssue` + `FindingOccurrence` (§5). Es el cambio del que dependen el triaje real, la comparación entre escaneos y un dashboard honesto.

**Qué NO debería modificarse todavía.** El motor de scanner y la resolución de plugins (funcionan bien); la separación scanner/IA (es correcta); la navegación y el sistema visual (cosmético frente a lo anterior); la fórmula del score (primero hay que decidir qué debe medir).

---

## 2. Repository and Architecture Map

```
api_analyser/
├─ apps/
│  ├─ api/                       NestJS · puerto 4000 · API en /api/v1
│  │  ├─ prisma/schema.prisma     23 modelos · 14 enums
│  │  └─ src/modules/
│  │     ├─ auth/                 JWT + Better Auth (exchange-session)
│  │     ├─ users/                CRUD, invitaciones, roles
│  │     ├─ projects/             Proyectos, OpenAPI, AuthConfig
│  │     ├─ assessments/          Orquestación + SSE + /dashboard
│  │     ├─ findings/             Listado, stats, cambio de estado
│  │     ├─ reports/              Generación multi-formato
│  │     ├─ plugins/              Registro, config, perfiles
│  │     ├─ scanner/              Motor (BullMQ) + 10 plugins
│  │     ├─ ai/                   Proveedores, cifrado, enriquecimiento
│  │     ├─ audit/                AuditLog
│  │     └─ finance/              ⚠ VACÍO
│  └─ web/                       Next.js 15 · App Router · puerto 3000
│     └─ src/
│        ├─ app/(auth)/ (dashboard)/
│        ├─ components/{layout,navigation,tables,filters,projects,
│        │              assessments,security,dashboard,ui,shared}
│        └─ lib/                  api.ts, project-list.ts, assessment-list.ts
└─ docker-compose.yml            PostgreSQL 16 · Redis 7
```

**Flujo de datos.** `Web → axios (lib/api.ts) → /api/v1 → NestJS → Prisma → PostgreSQL`. El escaneo se desvía: `assessments.service → BullMQ (Redis) → scanner.processor → plugins → Finding[]`, con progreso emitido por SSE de vuelta al navegador.

**Contradicciones con el README [C].**
- El README documenta `plugins/ai-analysis/` como directorio de plugin. **No existe**; la IA vive en `modules/ai/` y actúa como post-proceso, no como plugin.
- El README menciona **Amazon Bedrock**. Los proveedores reales inicializados al arrancar son **OpenAI** (`gpt-4o-mini`) y **Ollama** (`llama3`).
- El README dice «Auth: JWT (HS256), Passport.js». El esquema contiene `Session`/`Account`/`Verification`, propios de **Better Auth**. Coexisten dos sistemas.

---

## 3. Current Product Flow

**Diseñado** (13 pasos del brief) frente a **implementado**:

| Paso | Estado | Evidencia |
|---|---|---|
| 1-4 Alta de proyecto, spec, auth | **[C]** Implementado | Asistente de 3 pasos en `project-drawer.tsx`, `DRAFT`→`READY` |
| 5 Selección de plugins/perfil | **[C]** Implementado | `AssessmentConfig.executionMode`: `all`\|`profile`\|`manual` |
| 6-7 Ejecución y encolado | **[C]** Implementado | BullMQ, `POST /assessments/projects/:id/run` |
| 8 Inspección de endpoints | **[C]** Implementado | 10 plugins en `scanner/plugins/` |
| 9 Progreso por SSE | **[C]** Implementado, **sin reanudación** | `@Sse(':id/progress')`, sin heartbeat ni `lastEventId` |
| 10 Generación de findings | **[C]** Implementado, **sin deduplicación** | §5 |
| 11 Enriquecimiento IA | **[C]** Implementado y bien aislado | `ai.service.ts` |
| 12 Reportes | **[C]** Implementado, **un registro por formato** | `reports.service.ts:168` |
| 13 Triaje | **[C] Parcial — no persiste entre escaneos** | §5 |

**Contradicción principal [C].** El paso 13 supone un ciclo de vida (revisar → clasificar → resolver → verificar en el siguiente escaneo). El modelo no lo soporta: cada escaneo reinicia todos los hallazgos a `OPEN`.

---

## 4. Current Domain Model

**Modelos por papel** (23 en total):

| Grupo | Modelos |
|---|---|
| Identidad | `User` `Session` `Account` `Verification` `Invitation` `ApiKey` |
| Objetivo | `Project` `ProjectSecret` `ApiSpec` `AuthConfig` `Endpoint` |
| Ejecución | `Assessment` `AssessmentConfig` `AssessmentSummary` `AssessmentLog` |
| Resultado | `Finding` `Report` |
| Motor | `Plugin` `PluginUserConfig` `PluginExecution` `ScanProfile` |
| Transversal | `AiProviderConfig` `AuditLog` |

**Diagrama actual [C]:**

```
User ──< Project ──< Assessment ──< Finding >── Endpoint
              │           │            (status vive aquí)
              │           ├── AssessmentConfig
              │           ├── AssessmentSummary
              │           ├── AssessmentLog
              │           └── Report
              ├── ApiSpec ──< Endpoint
              │       └── AuthConfig
              └── ProjectSecret

Plugin ──< PluginUserConfig      ScanProfile (enabledPlugins: String[])
       └─< PluginExecution
```

**Limitaciones confirmadas.**

1. **[C] Sin identidad de vulnerabilidad.** Búsqueda de `fingerprint|firstSeen|lastSeen|resolvedAt|reopen|assignee|dedup|hash` en el esquema: solo aparece `keyHash` en `ApiKey`. Nada en `Finding`.
2. **[C] Cero índices.** El esquema declara 3 `@@unique` (`ProjectSecret`, `Endpoint`, `PluginUserConfig`) y **ningún `@@index`**. `Finding` se consulta por `assessmentId`, `severity`, `status` y `project.userId` sin soporte.
3. **[C] Cascada destructiva.** `Finding.assessment` usa `onDelete: Cascade`. `DELETE /assessments/:id` elimina hallazgos y su triaje.
4. **[C] `ScanProfile.enabledPlugins` es `String[]`**, no relación. Sin integridad referencial: un perfil puede apuntar a plugins inexistentes. El worker lo detecta en ejecución y aborta (`scanner.processor.ts:87`), pero es una validación tardía.
5. **[C] Métricas por proyecto solo por travesía.** No hay `Project → Finding`; hay que atravesar assessments (lo que hace `projects.service.ts findAll()`).

**Qué NO puede representar el modelo actual [C]:** vulnerabilidad recurrente · resuelta · reabierta · cambio de severidad entre escaneos · comparación entre assessments · antigüedad real de un problema.

---

## 5. Finding Lifecycle Analysis

**¿Qué representa hoy un Finding? [C]** Una **observación puntual dentro de un escaneo**. Su clave primaria es propia, su padre obligatorio es `assessmentId`, y su ciclo de vida muere con el assessment.

**¿Es persistente? [C]** No. Pertenece al assessment.

**¿Cómo se identifica la misma vulnerabilidad entre escaneos? [C]** **No se identifica.** No hay fingerprint ni criterio de deduplicación. Dos escaneos consecutivos del mismo proyecto producen dos conjuntos disjuntos de registros.

**¿Qué ocurre al volver a detectarla? [C]** Se crea un `Finding` nuevo con `status = OPEN` (default del esquema). El triaje anterior no se consulta.

**¿Qué ocurre al resolverla? [C]** Se marca `RESOLVED` en ese registro. El siguiente escaneo la vuelve a crear como `OPEN`. **El trabajo de triaje se pierde en cada escaneo.**

**¿Puede reabrirse? [C]** No existe el concepto. No hay `reopenCount` ni transición registrada.

**¿Conviene introducir `SecurityIssue` + `FindingOccurrence`? [R] Sí, y es la reforma de mayor valor del proyecto.** La propuesta del brief es correcta. Justificación desde el código: hoy el triaje es un campo mutable sobre un registro inmutable por naturaleza (la observación de un escaneo). Son dos ciclos de vida distintos forzados en una tabla.

**Modelo recomendado [R]:**

```
Project ──< SecurityIssue ──< FindingOccurrence >── Assessment
                 │                    │
                 │                    └─> evidence, httpRequest/Response,
                 │                        severity observada, aiAnalysis
                 └─> fingerprint (unique por proyecto)
                     status, notes, assigneeId      ← triaje persistente
                     firstSeenAt, lastSeenAt, resolvedAt, reopenCount
                     currentSeverity, pluginId, endpointId
                     └─< IssueStatusChange (historial de triaje)
```

- **`SecurityIssue`** — la vulnerabilidad lógica y persistente. Aquí vive **todo el triaje**. `@@unique([projectId, fingerprint])`.
- **`FindingOccurrence`** — inmutable. La evidencia de que el escaneo X vio el problema. Aquí vive la evidencia y el enriquecimiento de IA.
- **`IssueStatusChange`** — quién cambió qué y cuándo. Requisito de auditoría en una herramienta de seguridad.

**Fingerprint [R]:** hash estable de `pluginId + owaspCategory + método + ruta normalizada` (plantilla de la ruta, no la URL con IDs concretos). No incluir severidad ni texto: deben poder cambiar sin partir la identidad.

**Regla de reapertura [R]:** al cerrar un escaneo, un `SecurityIssue` en `RESOLVED` que reaparece pasa a `OPEN` con `reopenCount++`. Uno en `ACCEPTED_RISK` o `FALSE_POSITIVE` **no** se reabre: esa decisión debe sobrevivir a los escaneos, o el triaje no sirve de nada.

**Migración [R]:** los datos actuales son recuperables — se puede derivar un `SecurityIssue` por cada grupo `(projectId, pluginId, owaspCategory, endpoint)` existente y convertir los `Finding` en ocurrencias, tomando el `status` más avanzado del grupo.

---

## 6. Assessment Comparison Analysis

**Funcionalidad actual [C]:** **inexistente**. Búsqueda de `baseline|previousAssessment|delta|compare|diff` en el backend: sin resultados. Ningún endpoint la ofrece.

**Datos ya disponibles [C]:** `Assessment.createdAt` (ordena la serie), `AssessmentSummary` (conteos y score por escaneo), `AssessmentConfig.resolvedPlugins` (alcance exacto de cada escaneo — dato clave y ya persistido), `Endpoint` por `ApiSpec`.

**Datos faltantes [C]:** identidad de finding entre escaneos (bloqueante), estado del proyecto en el momento del escaneo, versión de la spec, y `PluginExecution` correlacionado con cobertura.

**Propuesta [R]:** vista `Scan A → Scan B` con cuatro cubos derivados del fingerprint: **New** (issues cuya `firstSeenAt` cae en B), **Recurring** (presentes en ambos), **Resolved** (en A, ausentes en B), **Reopened** (`reopenCount` incrementado en B). Más delta de score, endpoints añadidos/eliminados y cambio de alcance.

**Riesgo de comparar escaneos con perfiles distintos [C, importante].** Si A corrió 10 plugins y B corrió 3, «Resolved» sería mentira: 7 comprobaciones simplemente no se ejecutaron. `resolvedPlugins` ya está persistido, así que **la comparación debe intersecar el alcance** y marcar explícitamente lo no cubierto como *Not tested*, nunca como *Resolved*. Esta es la trampa principal de la funcionalidad.

---

## 7. Security Score Audit

**Fórmula actual [C]** — `apps/api/src/modules/scanner/scanner.processor.ts:312-325`, método `calculateSummary`:

```ts
let score = 100;
score -= critical * 20;
score -= high     * 10;
score -= medium   *  5;
score -= low      *  2;
score = Math.max(0, Math.min(100, score));
```

**Problemas confirmados.**

1. **[C] No normaliza por tamaño.** La firma es `calculateSummary(findings, _totalEndpoints)` — el segundo parámetro está prefijado con `_` porque **no se usa**. Una API de 5 endpoints y otra de 500, ambas con 5 críticos, obtienen 0. El score mide volumen absoluto, no postura.
2. **[C] Se congela.** Se calcula una vez al terminar el escaneo y se persiste en `AssessmentSummary`. Marcar 5 críticos como `FALSE_POSITIVE` deja el score en 0 para siempre. **El triaje no influye en la métrica principal del producto.**
3. **[C] Saturación temprana.** Cinco críticos llevan a 0. A partir de ahí, 5 y 50 críticos son indistinguibles.
4. **[C] Rama muerta en `riskLevel`:**
   ```ts
   else if (high > 2)               riskLevel = 'HIGH';
   else if (high > 0 || medium > 3) riskLevel = 'HIGH';
   ```
   Ambas asignan `'HIGH'` y la segunda cubre a la primera. La primera condición es redundante.

**Score global [C]** — `assessments.service.ts:251-255`:
```ts
const avgScore = assessments.reduce((sum, a) => sum + (a.summary?.securityScore ?? 100), 0) / assessments.length;
```
- **[C]** Promedia **todos los assessments históricos**, no el último de cada proyecto. Escanear un proyecto malo 10 veces lo pondera 10×.
- **[C]** Un assessment sin summary (fallido, en cola, cancelado) cuenta como **100**. Los escaneos rotos **suben** la postura de seguridad.
- **[C]** Un proyecto sin escanear no aparece: riesgo desconocido se lee como ausencia de riesgo.

**Definiciones propuestas [R]:**
- **Assessment score** — instantánea de un escaneo, normalizada por endpoints probados y por alcance de plugins. Inmutable.
- **Project score** — derivado de los `SecurityIssue` **abiertos** del proyecto, excluyendo `FALSE_POSITIVE` y `ACCEPTED_RISK`. Recalculado al cambiar el triaje. Es el número que debe mandar en la interfaz.
- **Global posture** — agregación del *project score* del **último escaneo de cada proyecto**, ponderada por entorno (producción pesa más), con los proyectos sin escanear contabilizados aparte como «cobertura desconocida», nunca como 100.

---

## 8. Page-by-Page UX and Information Audit

### Dashboard — `app/(dashboard)/dashboard/page.tsx`
**Objetivo:** postura global. **Datos:** `assessmentsApi.dashboard`, refresco 30 s.
**Problemas [C]:** el score mostrado hereda los tres defectos de §7. **[I]** «Security Score» y «Overall Security Score» proceden del mismo `avgSecurityScore`: el mismo dato con dos nombres. **[C]** `owaspCoverage` cuenta *hallazgos por categoría*, no *cobertura de comprobaciones* — un dashboard que muestre eso como «cobertura OWASP» invierte el significado: más vulnerabilidades parecerían mejor cobertura.
**Recomendación [R]:** reorientar de «cuánto tengo» a «qué cambió»: nuevos issues desde el último escaneo, issues reabiertos, proyectos que empeoraron, escaneos fallidos, proyectos sin escanear.

### Projects — `app/(dashboard)/projects/page.tsx`
**Objetivo:** inventario. Tarjetas con filtros en URL y paginación de 12.
**[R]** El formato tarjeta está **justificado**: pocos elementos, heterogéneos, con estado de configuración y acción principal por elemento. No convertir a tabla (§12).
**Falta [R]:** postura por proyecto (issues abiertos por severidad) y antigüedad del último escaneo.

### Project Detail — `projects/[projectId]/page.tsx`
**[R]** Es la página con más recorrido pendiente. Debería estructurarse en Overview · Endpoints · Scans · Issues · Reports · Configuration. Hoy `Endpoints` no tiene superficie propia pese a estar modelado y poblado.

### Run Assessment — `components/projects/run-assessment-sheet.tsx`
**[C] Correcto.** El modo elegido se resuelve y congela en `resolvedPlugins` antes de encolar. Lo mostrado es lo ejecutado.

### Assessments — `app/(dashboard)/assessments/page.tsx`
**Objetivo:** historial de ejecuciones. Refresco 10 s.
**Falta [C]:** comparación con el escaneo anterior (§6) y delta de score — el propósito natural de un historial.

### Assessment Detail — `assessments/[assessmentId]/page.tsx`
**[C]** Progreso SSE + logs + resumen + hallazgos.
**Problema [C]:** sin reanudación de SSE. `@Sse(':id/progress')` no emite heartbeat ni gestiona `lastEventId`. Al recargar o perder red, el progreso queda mudo aunque el worker siga vivo.

### Findings — `app/(dashboard)/findings/page.tsx`
**Problema estructural [C]:** lista **ocurrencias**, no problemas. Con 5 escaneos, el mismo CORS aparece 5 veces sin relación entre sí. Es el síntoma visible del defecto de §5.
**Problema [C]:** filtros server-side de valor único (alimentan `queryKey` → `findingsApi.list()`), incoherentes con el multi-select de Projects y Assessments.

### Finding Sheet vs Finding Detail — `findings/page.tsx` (Sheet) y `findings/[findingId]/page.tsx`
**[C]** Duplicación real: descripción, impacto, OWASP, CVSS y remediación se renderizan en ambos. **[R]** El Sheet debe ser triaje rápido (severidad, endpoint, acción de estado, enlace); la página completa, evidencia + historial de ocurrencias + enriquecimiento de IA, con separación visual explícita entre lo observado por el scanner y lo generado por IA.

### Reports — `app/(dashboard)/reports/page.tsx`
**[C]** Cada generación crea un registro (`reports.service.ts:168`). Pedir el mismo informe en PDF y HTML produce **dos filas** que el usuario percibe como dos informes.
**[R]** Agrupar por `(assessmentId, type)` con los formatos como artefactos descargables de una misma entrada.

### Finance — `app/(dashboard)/finance/page.tsx`
**[C] No funciona.** Endpoints 404, módulo vacío (§11).

### Plugins / Profiles — `app/(dashboard)/plugins/*`
**[C]** «Installed Plugins» es engañoso: los 10 plugins están compilados en el binario (`scanner/plugins/`), no se instalan ni desinstalan. **[R]** Renombrar a *Security Checks*.

### Settings — `app/(dashboard)/settings/page.tsx`
**[C] Datos falsos en producción:** la pestaña API Tokens usa `const MOCK_TOKENS = [...]` (línea 364) y `useState(MOCK_TOKENS)` (línea 385). La interfaz muestra tokens inventados que ningún backend respalda, pese a existir el modelo `ApiKey`.

---

## 9. AI Enrichment Audit

**Flujo [C]:** post-proceso tras la ejecución de plugins, dentro de `modules/ai/`. No es un plugin (contradice el README).
**Proveedores [C]:** OpenAI (`gpt-4o-mini`) y Ollama (`llama3`), uno activo a la vez. Claves cifradas con `createCipheriv` (`ai-config.service.ts:159-166`).
**Persistencia [C]:** `Finding.aiSummary`, `Finding.aiAnalysis` (Json), `Finding.aiGeneratedAt`.

**Separación evidencia / IA [C] — correcta.** `ai.service.ts:82-83,162` solo asigna a `aiAnalysis` y `executiveSummary`. **La IA no puede cambiar severidad, evidencia ni estado.** El generador de informes la aísla en un bloque «AI security enrichment» (`report-generator.service.ts:232`). Esta decisión es acertada y debe preservarse.

**Carencias [C]:**
- No se persisten `provider`, `model` ni versión del prompt junto al resultado. Solo `aiGeneratedAt`. **Los resultados no son reproducibles ni auditables**: dentro de seis meses no se sabrá qué modelo escribió una recomendación.
- No hay `confidence` ni `falsePositiveRisk` en el esquema, pese a mencionarse como objetivo.
- **[?]** Manejo de 429, timeouts y reintentos: no verificado en profundidad; requiere revisar `ai.service.ts` completo.
- **[C]** No hay registro de tokens ni coste — la causa raíz de que Finance no tenga datos que mostrar (§11).

**Propuesta [R]:** añadir a la ocurrencia `aiProvider`, `aiModel`, `aiPromptVersion`, `aiConfidence`, `aiTokensUsed`, `aiCostUsd`. Con eso, Finance deja de necesitar un módulo inventado y la IA se vuelve auditable. Los playbooks (root cause, business impact, remediación por framework/cloud, verificación, referencias) deben vivir como plantillas de prompt versionadas, no incrustadas en código.

---

## 10. Plugin and Profile Execution Audit

**Plugins reales [C]** — 10 en `apps/api/src/modules/scanner/plugins/`: `bola`, `bfla`, `broken-auth`, `jwt-analysis`, `mass-assignment`, `sensitive-data`, `ssrf`, `rate-limit`, `security-headers`, `cors`. Se registran y sincronizan con la BD al arrancar (confirmado en los logs de arranque: «Registered 10 built-in plugins / Synced 10 plugins to database»).

**Ejecución real [C] — correcta.** `scanner.processor.ts:69-90`:
- Usa `resolvedPlugins` congelado por la API.
- Comentario explícito: *«Never fall back to all plugins when an explicit selection is empty/invalid»*.
- Aborta si algún plugin ya no existe (`pluginOverride.length !== resolvedPluginIds.length`).
- **Los tres modos (`all` / `profile` / `manual`) funcionan y el frontend no miente sobre el alcance.**

**Problemas [C]:**
- **Categorías sin plugins:** `PluginCategory` declara 12 valores; los 10 plugins no cubren `INJECTION`, `API_DESIGN`, `PERFORMANCE`, `INFRASTRUCTURE`, `COMPLIANCE`, `AI`, `CLOUD`, `GRAPHQL`, `GRPC`. **[R]** No exponer en la interfaz categorías vacías: en una herramienta de seguridad, sugerir cobertura inexistente es un fallo de producto grave.
- **`ScanProfile.enabledPlugins` es `String[]`** sin integridad referencial (§4).

---

## 11. Reports and Finance Audit

**Reports [C]:** funcional. Tipos `EXECUTIVE`/`TECHNICAL`/`COMPLIANCE`/`DEVELOPER`, formatos `PDF`/`HTML`/`MARKDOWN`/`JSON`/`SARIF`. Generación automática al terminar el escaneo (`autoGenerateReport`, tipo `TECHNICAL`, formato `PDF`).
- **[C] Duplicación por formato:** un `report.create` por generación.
- **[I] Inmutabilidad no garantizada:** se persiste `fileSize` y el contenido generado; como los `Finding` son mutables (`status`, `notes`) y el informe los incorpora, **regenerar el mismo informe puede producir un documento distinto**. Para cumplimiento, un informe debe ser reproducible o inmutable — hoy no es claramente ninguna de las dos.

**Finance [C]: no existe backend.**
- `apps/api/src/modules/finance/` está **vacío**.
- Cero ocurrencias de «finance» en `apps/api/src`.
- Ningún controlador registrado al arrancar.
- Verificado en vivo: `GET /api/v1/finance/summary` → **404**.
- El frontend llama a `financeApi.summary()` y `financeApi.usage()`.

**[R] Recomendación: ocultar la sección**, no borrar el código. La causa real es que no se registra el consumo de IA (§9). Una vez persistidos tokens y coste por ocurrencia, reintroducirlo como **AI Usage dentro de Settings** — es configuración operativa, no un dominio de primer nivel que merezca sitio en la navegación principal.

---

## 12. Navigation and Design System Audit

**Duplicación de navegación [C].** `nav-data.ts` expande las **9 pestañas de Settings** como entradas del sidebar (`/settings?tab=…`), y la propia página las repite como tabs. El usuario ve el mismo conjunto dos veces. **[R]** Dejar «Settings» como entrada única y que la navegación interna viva en la página.

**Tarjetas vs tablas [C, justificado].** Projects usa tarjetas; Assessments/Findings/Reports usan tablas. **Es correcto y no debe unificarse.** Un proyecto es una entidad heterogénea, poca cantidad, con estado de configuración y acción principal propia. Un assessment o un finding es una fila de una serie homogénea que se ordena, filtra y compara. La diferencia responde al tipo de información, no a inconsistencia.

**Inconsistencias reales [C]:**
- Filtros: Projects y Assessments filtran en cliente con multi-select y chips en URL; Findings filtra en servidor con valor único. Mismo gesto, tres comportamientos.
- Idioma: Projects en español; Dashboard, Assessments, Findings, Reports, Settings en inglés.
- `components/filters/` (`FilterChips`, `FilterPopover`) ya está extraído y compartido entre Projects y Assessments — **base correcta**; Findings aún no lo adopta.

**Mapa de adopción de los componentes previstos [R]:**

| Componente | Equivalente actual | Adopción | Riesgo |
|---|---|---|---|
| `CommandDialog` | `components/layout/command-menu.tsx` | Extender a búsqueda global de projects/scans/issues/reports | Bajo — ya existe base |
| `Pagination` | `ui/pagination.tsx` (Projects) + `data-table-pagination.tsx` (tablas) | **Dos sistemas distintos**; unificar | Medio — semánticas diferentes (URL vs estado TanStack) |
| `Progress` | `ui/progress.tsx` | Detalle de assessment | **Debe conectarse al SSE real**, no a simulación (§8) |
| `Avatar` | `ui/avatar.tsx` | `nav-user`, audit logs, futuro `assignee` | Bajo |

**Navegación propuesta [R]:** `Dashboard · Projects · Scans · Issues · Reports · Security Checks · Settings`.
- `Assessments → Scans` **[R] sí**: más corto y es el término del dominio.
- `Findings → Issues` **[R] sí, pero solo después de §5.** Renombrar antes de que existan `SecurityIssue` sería cambiar la etiqueta sin cambiar el concepto — el usuario seguiría viendo duplicados llamados «issues».
- `Installed Plugins → Security Checks` **[R] sí**, con Profiles como pestaña.
- `Finance → AI Usage` en Settings **[R] sí**.

---

## 13. Security Architecture Review

| Sev | Hallazgo | Evidencia |
|---|---|---|
| **Critical** | `ENCRYPTION_KEY` con fallback en el repositorio: `'fallback-encryption-key-32chars'`. Sin la variable de entorno, todo secreto se cifra con una clave pública. Debe fallar el arranque, no degradarse en silencio. **[C]** | `apps/api/src/config/configuration.ts:22` |
| **High** | El esquema marca `AuthConfig.token/password/apiKey/clientId/clientSecret` con `// encrypted`, pero no se localizó cifrado en la ruta de escritura. Serían credenciales de APIs de terceros en claro. **[C, requiere confirmación puntual]** | `schema.prisma` modelo `AuthConfig`; `projects.service.ts:291` |
| **High** | `Finding.httpRequest` / `httpResponse` almacenan tráfico crudo sin redacción documentada. Puede contener tokens y datos personales de la API auditada, y se incorpora a los informes. **[I]** | `schema.prisma` modelo `Finding`; `report-generator.service.ts` |
| **Medium** | Sin índices en `Finding`: consultas por `assessmentId`/`severity`/`status` degradan con el volumen; superficie de DoS por consulta costosa. **[C]** | `schema.prisma` |
| **Medium** | SSE sin heartbeat ni reanudación: conexiones colgadas y estado incierto tras reconectar. **[C]** | `assessments.controller.ts:64` |
| **Low** | `ScanProfile.enabledPlugins` sin integridad referencial; validación tardía en el worker. **[C]** | `schema.prisma`; `scanner.processor.ts:87` |
| **Info** | Existe `url-resolver.util.ts` con `assertSafeRemoteUrl` para la importación de specs — mitigación SSRF **presente** en el ingreso de OpenAPI. **[C]** | `apps/api/src/common/utils/url-resolver.util.ts` |
| **Info** | Aislamiento multi-tenant correcto y consistente en findings. **[C]** | `findings.service.ts` |

**No verificado [?]:** rate limiting de la API, límite de tamaño en subida de specs, aislamiento de la cola BullMQ entre tenants, redacción de secretos en `AssessmentLog`.

---

## 14. Confirmed Bugs and Functional Gaps

| ID | Área | Problema | Evidencia | Impacto | Sev | Esfuerzo | Dependencias |
|---|---|---|---|---|---|---|---|
| B-01 | Dominio | Sin identidad de vulnerabilidad entre escaneos | `schema.prisma` `Finding` | Triaje inútil; sin comparación | **P0** | L | — |
| B-02 | Dominio | Triaje se pierde en cada escaneo | `Finding.status` por assessment | Retrabajo permanente | **P0** | L | B-01 |
| B-03 | Dominio | `onDelete: Cascade` destruye triaje al borrar scan | `schema.prisma` `Finding` | Pérdida de datos | **P0** | S | B-01 |
| B-04 | Seguridad | `ENCRYPTION_KEY` con fallback público | `configuration.ts:22` | Secretos comprometidos | **P0** | XS | — |
| B-05 | Seguridad | `AuthConfig` marcado cifrado sin cifrar | `projects.service.ts:291` | Credenciales de terceros en claro | **P0** | M | B-04 |
| B-06 | Métricas | Score global promedia todo el histórico y cuenta 100 los scans sin summary | `assessments.service.ts:251-255` | Postura inflada | **P1** | S | — |
| B-07 | Métricas | Score ignora `totalEndpoints` y no se recalcula tras triaje | `scanner.processor.ts:312-325` | Métrica engañosa | **P1** | M | B-01 |
| B-08 | Métricas | Rama muerta en `riskLevel` | `scanner.processor.ts:328-330` | Lógica confusa | **P3** | XS | — |
| B-09 | Finance | UI sin backend, endpoints 404 | módulo vacío; 404 verificado | Sección rota visible | **P1** | S (ocultar) | §9 |
| B-10 | Settings | API Tokens con `MOCK_TOKENS` | `settings/page.tsx:364,385` | Datos falsos en producción | **P1** | M | — |
| B-11 | Rendimiento | Cero `@@index` en el esquema | `schema.prisma` | Degradación con volumen | **P1** | S | — |
| B-12 | SSE | Sin heartbeat ni reanudación | `assessments.controller.ts:64` | Progreso mudo al recargar | **P2** | M | — |
| B-13 | Reports | Un registro por formato | `reports.service.ts:168` | Listado confuso | **P2** | M | — |
| B-14 | IA | Sin `provider`/`model`/prompt version persistidos | `schema.prisma` `Finding` | Resultados no auditables | **P2** | S | — |
| B-15 | Plugins | 12 categorías declaradas, 10 plugins | `PluginCategory` | Cobertura aparente falsa | **P2** | XS | — |
| B-16 | Docs | README: `ai-analysis` plugin y Bedrock inexistentes | README vs código | Desinformación | **P3** | XS | — |
| B-17 | Frontend | Idiomas mezclados | Projects ES, resto EN | Incoherencia | **P2** | L | i18n |
| B-18 | Frontend | `lastScanStatus` sin consumidor | `projects.service.ts` findAll | Payload muerto | **P3** | XS | — |

---

## 15. Redundancies and Unnecessary Features

**Eliminar:** `MOCK_TOKENS` (B-10) · rama muerta de `riskLevel` (B-08) · `lastScanStatus` si no se reutiliza (B-18).
**Ocultar:** Finance hasta que exista registro de consumo (B-09) · categorías de plugin sin implementación (B-15).
**Combinar:** los dos sistemas de paginación · Sheet y página de finding (delimitar responsabilidades, no fusionar) · informes del mismo assessment+tipo agrupados por formato.
**Renombrar:** `Assessments → Scans` · `Installed Plugins → Security Checks` · `Findings → Issues` (solo tras §5).
**Conservar intacto:** resolución y congelado de plugins · aislamiento multi-tenant · separación scanner/IA · `assertSafeRemoteUrl` · tarjetas en Projects.

---

## 16. Recommended Target Architecture

```
User ──< Project ──< Assessment (Scan) ──< FindingOccurrence
              │            │                      │
              │            ├── AssessmentConfig    │ (inmutable: evidencia,
              │            ├── AssessmentSummary   │  severidad observada,
              │            ├── AssessmentLog       │  aiAnalysis + provider/model)
              │            └── Report              │
              │                                    │
              └──< SecurityIssue ───────────────────┘
                       │  fingerprint @@unique([projectId, fingerprint])
                       │  status, notes, assigneeId    ← triaje persistente
                       │  firstSeenAt, lastSeenAt, resolvedAt, reopenCount
                       └──< IssueStatusChange          ← historial auditable
```

**Navegación:** `Dashboard · Projects · Scans · Issues · Reports · Security Checks · Settings`
**Detalle de proyecto:** `Overview · Endpoints · Scans · Issues · Reports · Configuration`
**Flujo:** Proyecto → Scan → Ocurrencias → **deduplicación por fingerprint** → Issues → Triaje persistente → Comparación → Informes.

---

## 17. Phased Reform Plan

**Phase 0 — Validación y salvaguardas.** Objetivo: poder reformar sin romper. Cobertura de tests sobre `calculateSummary`, resolución de plugins y aislamiento por usuario; backup de BD; fijar `ENCRYPTION_KEY` sin fallback (B-04). *No tocar:* nada de dominio. *Aceptación:* suite verde y arranque que falla sin `ENCRYPTION_KEY`.

**Phase 1 — Dominio y base de datos.** `SecurityIssue`, `FindingOccurrence`, `IssueStatusChange`; fingerprint; índices (B-11); cascadas revisadas (B-03); cifrado de `AuthConfig` (B-05). Migración con backfill desde los `Finding` actuales. *Riesgo: alto — irreversible.* *Aceptación:* dos escaneos consecutivos producen **un** issue con dos ocurrencias, y el triaje sobrevive.

**Phase 2 — Servicios y APIs.** Endpoints de issues, ocurrencias, historial y comparación. Recálculo de score sobre issues abiertos (B-06, B-07). Registro de consumo de IA (B-14). *Depende de:* Fase 1.

**Phase 3 — Sistema UI compartido.** Unificar filtros (Findings al patrón compartido), paginación, estados vacíos/carga/error. *Independiente de 1-2, puede paralelizarse.*

**Phase 4 — Flujo de proyecto y escaneo.** Detalle de proyecto por pestañas; superficie de Endpoints; SSE con heartbeat y reanudación (B-12).

**Phase 5 — Issues y triaje.** Listado de issues deduplicados; Sheet como triaje rápido; página completa con historial de ocurrencias; renombrado a Issues. *Depende de:* 1, 2, 3.

**Phase 6 — Dashboard y comparación.** Vista Scan A ↔ Scan B con intersección de alcance; dashboard orientado al cambio. *Depende de:* 1, 2, 5.

**Phase 7 — Reports, checks y settings.** Agrupar informes por formato (B-13); renombrar a Security Checks y ocultar categorías vacías (B-15); Tokens reales (B-10); navegación de Settings sin duplicar (§12).

**Phase 8 — Enriquecimiento IA.** Playbooks versionados; `confidence` y `falsePositiveRisk`; AI Usage en Settings sustituyendo a Finance (B-09).

**Phase 9 — SaaS y runner privado.** Organizaciones/tenants, aislamiento de cola, runner para APIs privadas. *No abordar antes:* el modelo de dominio debe estar estable.

---

## 18. Priority Matrix

| Recomendación | Valor | Seguridad | Riesgo téc. | Esfuerzo | Prioridad |
|---|---|---|---|---|---|
| `ENCRYPTION_KEY` sin fallback | Bajo | **Crítico** | Bajo | XS | **P0** |
| Cifrar `AuthConfig` | Bajo | **Crítico** | Medio | M | **P0** |
| `SecurityIssue` + `FindingOccurrence` | **Muy alto** | Medio | **Alto** | L | **P0** |
| Revisar cascadas de borrado | Medio | Alto | Bajo | S | **P0** |
| Índices en Prisma | Medio | Medio | Bajo | S | **P1** |
| Corregir score global y de proyecto | **Alto** | Medio | Medio | M | **P1** |
| Ocultar Finance | Medio | Bajo | Bajo | XS | **P1** |
| Tokens reales o retirar la pestaña | Medio | Alto | Bajo | M | **P1** |
| SSE con reanudación | Medio | Bajo | Medio | M | **P2** |
| Comparación entre escaneos | **Muy alto** | Medio | Medio | L | **P2** |
| Unificar filtros y paginación | Medio | — | Bajo | M | **P2** |
| Agrupar informes por formato | Medio | Bajo | Bajo | M | **P2** |
| Metadatos de IA | Medio | Medio | Bajo | S | **P2** |
| Renombrados de navegación | Medio | — | Bajo | S | **P2** |
| i18n | Medio | — | Medio | L | **P3** |
| Corregir README | Bajo | Bajo | Bajo | XS | **P3** |

---

## 19. Questions That Must Be Answered Before Implementation

Solo lo que el repositorio no puede responder:

1. **Alcance del fingerprint.** ¿El mismo fallo en `/users/{id}` y `/orders/{id}` es un issue por endpoint o uno por plugin+categoría? Determina el volumen de la cola de triaje y no puede deducirse del código.
2. **Persistencia de `ACCEPTED_RISK`.** ¿Caduca a los N meses o dura hasta revocarse? Afecta a la regla de reapertura.
3. **Multi-tenant real.** ¿Habrá organizaciones con proyectos compartidos, o el modelo seguirá siendo un usuario dueño de sus proyectos? Condiciona la Fase 1 — hacerlo después es mucho más caro.
4. **Datos existentes.** ¿Hay que preservar los findings actuales, o el entorno es descartable? Cambia el coste de la migración de días a horas.
5. **Cumplimiento de informes.** ¿Deben ser inmutables por requisito (auditoría universitaria o cliente), o basta con que sean reproducibles?
6. **Idioma de producto.** Español, inglés o bilingüe con i18n.

---

## 20. Final Recommendation

**Implementar primero:** Fase 0 completa más B-04 (`ENCRYPTION_KEY`). Son horas de trabajo y eliminan el riesgo crítico. Inmediatamente después, la Fase 1 — es el cuello de botella del que dependen triaje, comparación, dashboard y métricas.

**No implementar todavía:** renombrados de navegación (cambiar «Findings» por «Issues» antes de que existan issues reales solo cambia la etiqueta del problema); i18n (se rehará sobre textos que van a cambiar); comparación entre escaneos (imposible sin fingerprint); Finance (falta el dato de origen, no el módulo).

**Decisiones de producto a confirmar:** las seis preguntas de §19, en especial la 1 y la 3.

**¿Está el sistema preparado para la reforma?** Sí. El backend está modularizado, el aislamiento por usuario es sólido, la resolución de plugins es correcta y la separación scanner/IA está bien planteada. La reforma es profunda pero recae sobre cimientos sanos.

**Mayor riesgo técnico:** la migración de la Fase 1. Convertir `Finding` en dos entidades toca esquema, servicios, informes y toda la interfaz de findings, y el backfill del fingerprint sobre datos existentes es irreversible sin backup.

**Mayor riesgo funcional:** que el producto siga presentando métricas en las que el usuario confía y que no significan lo que aparenta. Un score que sube porque un escaneo falló, y una cobertura OWASP que en realidad cuenta vulnerabilidades, son peores que no mostrar nada: en una herramienta de seguridad, una métrica engañosa produce decisiones equivocadas.

---

## 21. Skills Used

**Realmente utilizada:** `ui-ux-pro-max` (instalada en `.agents/skills/`) — consultada en trabajo previo de esta sesión para jerarquía visual, accesibilidad y contraste en dark mode; sus criterios sustentan §8 y §12 (dark mode, estados de foco, jerarquía tipográfica, densidad de dashboard).

**Disponibles y no aplicables aquí:** `dataviz` (no se rediseñaron gráficas), `artifact-design` / `artifact-capabilities` (se descartó el formato artefacto a petición del usuario), `code-review`, `security-review`, `verify`, `simplify` (todas modifican o revisan diffs, incompatibles con una fase de solo análisis).

**No existen skills instaladas** específicas de NestJS, Prisma, PostgreSQL, Application Security, API Security, Cloud Security o arquitectura SaaS. Ese análisis (§5, §7, §13, §16) procede de inspección directa del código y no de una skill: **no invento skills que no estén disponibles.**

---

### Nota sobre el estado del repositorio

`git status` muestra archivos modificados, pero **ninguno procede de esta auditoría**, que se realizó exclusivamente con comandos de lectura. Corresponden al trabajo previo de la misma sesión: rediseño de filtros de Projects y Assessments, sistema de tablas, `calendar.tsx` y `slider.tsx`, corrección del autosave del drawer, `popover` en `tailwind.config.ts` y `ARCHITECTURE.md`.
