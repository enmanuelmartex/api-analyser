# API Analyser — Reporte de Estado de la Aplicación

**Fecha:** 2026-08-08
**Rama:** `main` · **HEAD:** `260a668` (merge de `reform/api-analyser-platform`)
**Árbol de trabajo:** 89 entradas sin commitear (54 modificadas + 35 sin seguimiento)
**Método:** inspección directa de código, ejecución real de tests / typecheck / lint, y consultas a la base de datos en ejecución. Todo lo que se afirma abajo fue verificado; lo que no pude verificar está marcado como tal.

---

## 1. Resumen ejecutivo

**Qué es:** una plataforma de evaluación automatizada de seguridad de APIs REST. Importa una especificación OpenAPI, descubre los endpoints, ejecuta 10 plugins de seguridad alineados con OWASP API Security Top 10 (2023), persiste las vulnerabilidades como entidades con ciclo de vida propio, calcula una puntuación de postura y genera reportes descargables (PDF, HTML, JSON, SARIF, Markdown).

**Estado real:** el núcleo funciona de punta a punta y está bien construido. Hay 4 escaneos completados en la base de datos, 31 vulnerabilidades persistidas, 4 PDFs generados con bytes reales en disco. La arquitectura del backend está por encima del promedio para un proyecto de este tipo: identidad estable de hallazgos (fingerprints), idempotencia ante reintentos, un único motor de scoring, cobertura separada de la puntuación, y credenciales cifradas en reposo.

**Dónde está el desbalance:** el backend está mucho más adelantado que el frontend. Aproximadamente **14 métodos del cliente API no tienen ningún consumidor en la UI** — scoring completo, comparación de escaneos, ejecución de plugin individual, estadísticas de issues, y hasta el botón de cancelar un escaneo. También hay un rebranding a "API Analyser" a medio propagar (código sí, README y 1 test no).

**Riesgo principal:** las 89 entradas sin commitear incluyen trabajo sustancial y funcional (artefactos de reporte, storage en disco, score-v2, branding, 2 migraciones). Un `git checkout` accidental destruiría trabajo real.

---

## 2. Verificaciones ejecutadas

| Comprobación | Comando | Resultado |
|---|---|---|
| Tests API | `bun test src` (en `apps/api`) | **388 pass / 3 fail** — 391 tests, 19 archivos, 15.5 s |
| Tests Web | `bun test src` (en `apps/web`) | **23 pass / 0 fail** — 1 solo archivo |
| Typecheck API | `bunx tsc --noEmit` | **Limpio** (0 errores) |
| Typecheck Web | `bunx tsc --noEmit` | **Limpio** (0 errores) |
| Lint API | `bun run lint:api` | **FALLA** — no existe `eslint.config.js` (ESLint 9 lo exige) |
| Lint Web | `bun run lint:web` | Pasa con **3 warnings**; el plugin de Next no está detectado en la config |
| Infraestructura | `docker ps` | `api-analyser-postgres` y `api-analyser-redis` arriba y healthy |
| Base de datos | `psql` | 24 tablas, 4 migraciones aplicadas, datos reales presentes |

### Los 3 tests que fallan

Los tres son **fixtures desactualizados, no defectos del producto**:

1. `reports.service.integration.spec.ts:146` — espera el nombre de archivo `api-analyser-project-…html`, el código produce `api-analyser-project-…html`. El test no se actualizó tras el rebranding.
2. `scoring.integration.spec.ts:127` — espera `scoreVersion === 'score-v1'`, el motor ahora emite `score-v2`. El test no se actualizó tras el cambio de versión.
3. `scoring.integration.spec.ts:185` — "prefers the most recent FINAL scan". El fixture fija `SCAN_B` a `2026-07-20` pero crea `SCAN_A` con `now()`. Desde que la fecha real superó el 20/07, `SCAN_A` **es** el más reciente y el servicio lo devuelve correctamente. **El test tiene un bug de dependencia temporal; `getProjectPosture` ordena bien.**

---

## 3. Arquitectura

Monorepo con Bun workspaces.

```
api_analyser/
├── apps/
│   ├── api/     NestJS 10  → puerto 4000, prefijo /api/v1
│   └── web/     Next.js 15 → puerto 3000 (App Router, React 19)
├── docker/      configuración de contenedores
├── docs/        inspección, modelo de dominio, este reporte
└── docker-compose.yml
```

| Capa | Tecnología |
|---|---|
| Runtime | Bun 1.x |
| Backend | NestJS 10, TypeScript 5.7 |
| Frontend | Next.js 15, React 19, Tailwind 3.4, shadcn/ui (bloque dashboard-01) |
| Base de datos | PostgreSQL 16 + Prisma 6 |
| Cola | Redis 7 + BullMQ 5 (concurrencia 3, 3 reintentos, backoff exponencial) |
| Auth | Better Auth (`/api/auth/*`) + JWT legacy (`/api/v1/auth/*`), puenteados |
| IA | 5 proveedores conectables + noop |
| PDF | `puppeteer-core` contra un Chromium del sistema |
| Observabilidad | Prometheus + Grafana (perfil opcional de compose) |

**Detalle de arranque relevante:** en `main.ts`, Better Auth se monta *antes* del enrutamiento de Nest y con el body-parser global desactivado, porque necesita el body sin parsear. El parser de Express se aplica manualmente solo a las rutas que no empiezan por `/api/auth`. Es frágil por naturaleza pero está documentado en el código.

Hay un `ValidationPipe` global con `whitelist`, `forbidNonWhitelisted` y `transform`. Esto bloquea mass-assignment **solo en endpoints cuyo body está tipado con un DTO de clase**; los bodies tipados como `any` o con tipos inline TS lo esquivan por completo (ver §12).

---

## 4. Modelo de datos

**24 modelos, 17 enums, 4 migraciones.** El esquema es la parte mejor diseñada del proyecto.

### Bloques

**Usuarios y organización** — `User`, `ApiKey`, `Session`, `Account`, `Verification`
`Session`/`Account`/`Verification` pertenecen a Better Auth. `ApiKey` existe pero **ningún servicio la lee** (0 filas, sin controlador).

**Proyectos y superficie de API** — `Project`, `ApiSpec`, `AuthConfig`, `Endpoint`
El proyecto tiene ciclo `DRAFT → READY` con `setupStep` para el asistente de creación. `AuthConfig` guarda credenciales **cifradas con AES-256-GCM**; nunca se devuelven al cliente, ni siquiera el ciphertext.

**Ejecución** — `Assessment`, `AssessmentConfig`, `AssessmentSummary`, `AssessmentLog`
`AssessmentConfig.resolvedPlugins` congela la selección de plugins *antes* de encolar el job. El worker respeta esa lista y nunca hace fallback a "todos".

**Vulnerabilidades (el corazón del rediseño)** — `SecurityIssue`, `FindingOccurrence`, `IssueStatusChange`
Un `SecurityIssue` es la vulnerabilidad persistente: sobrevive a rescaneos y al borrado del escaneo que la descubrió. Una `FindingOccurrence` es una detección concreta con snapshots inmutables (severidad, método, ruta, título al momento del escaneo). `IssueStatusChange` es la bitácora de triaje.

**Reportes** — `Report` (con `version`, `sourceSnapshot`, `filePath`, `fileSize`, checksum)

**Plugins** — `Plugin`, `PluginUserConfig`, `PluginExecution`, `ScanProfile`

**Otros** — `AiProviderConfig` (credenciales de IA cifradas), `AuditLog`

### Enums de contrato que conviene conocer

- **`IssueStatus`**: `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `ACCEPTED_RISK`, `FALSE_POSITIVE`. `FALSE_POSITIVE` nunca se reabre automáticamente; `ACCEPTED_RISK` solo reabre cuando expira la aceptación.
- **`ScoreStatus`**: `UNAVAILABLE` (score obligatoriamente `null`) / `PROVISIONAL` / `FINAL`. Solo un `FINAL` sin hallazgos penalizados puede mostrar 100. No existe ningún `|| 100` en el código.
- **`OccurrenceValidation`**: `UNVERIFIED` / `VERIFIED` / `REFUTED` — confianza en *una observación*, distinta del triaje del issue.

### Estado real de la base de datos

| Tabla | Filas |
|---|---|
| users | 1 |
| projects | 5 |
| endpoints | 371 |
| assessments | 4 (todos `COMPLETED`) |
| security_issues | 31 (todos `OPEN`) |
| finding_occurrences | 31 |
| plugin_executions | 40 |
| reports | 4 (TECHNICAL/PDF, todos con archivo + snapshot) |
| plugins | 10 (todos habilitados) |
| scan_profiles | 7 (6 de sistema + 1 de usuario) |
| audit_logs | **0** |
| api_keys | **0** |

Distribución de issues: 24 MEDIUM, 7 HIGH. Por plugin: `bfla` 14, `security-headers` 10, `cors` 4, `broken-authentication` 2, `rate-limit` 1.

Snapshots de score: 3 en `score-v2` (rango 1–72) y **1 huérfano en `score-v1` (score 14)** — no hubo backfill al cambiar de versión.

---

## 5. Módulos del backend

**74 endpoints en 11 módulos.** Todos bajo `/api/v1` salvo Better Auth.

### 5.1 `auth` — 4 endpoints ✅ Funcional

| Método | Ruta | Notas |
|---|---|---|
| POST | `/auth/register` | público, DTO validado |
| POST | `/auth/login` | público, DTO validado |
| POST | `/auth/exchange-session` | público — canjea sesión de Better Auth por JWT |
| GET | `/auth/me` | JWT |

**Autenticación dual.** El login web pasa por Better Auth (tabla `accounts`); los usuarios sembrados por Nest solo sirven para la API directa. `exchange-session` es el puente. El JWT se guarda en `localStorage` (`api.ts:16`) → legible por XSS; es una decisión consciente pero sigue siendo una exposición.

La estrategia JWT acepta el token también por query string (`?token=`), específicamente porque `EventSource` no puede enviar headers. Esto habilita el SSE de progreso.

### 5.2 `users` — ✅ Funcional, admin-only

Listado, CRUD, cambio de rol, activación/desactivación, reseteo de contraseña y logs de auditoría.

**Actualizado (2026-08-14):** el sistema de invitaciones se eliminó por completo — endpoints, modelo `Invitation` y la pantalla `/accept-invite`. Nunca llegó a enviar correo: el paso intermedio de 2026-08-11 hacía que `POST /users/invite` devolviera el enlace al administrador para entregarlo a mano, lo cual es estrictamente más trabajo que crear la cuenta directamente y además dejaba una cuenta a medio configurar en la base de datos hasta que el invitado la reclamara. Los administradores crean cuentas desde Settings → Users.

Que ahora exista transporte de correo (relay o Resend) no lo resucita: el correo transaccional de este producto son informes y resúmenes, no alta de usuarios.

Es el único módulo (junto con `auth`) que escribe en `AuditLog`.

### 5.3 `projects` — 11 endpoints ✅ Funcional

Listado, detalle, creación, borradores (`createDraft` / `saveDraft` / `finalize`), actualización, borrado lógico (`isActive=false`), importación de OpenAPI por URL o por contenido, y configuración de autenticación.

**Aislamiento por usuario correcto:** `assertOwner()` y `where: { userId }` en todas las lecturas. No encontré IDOR.

La importación por URL pasa por `assertSafeRemoteUrl()`, que resuelve DNS y rechaza direcciones privadas salvo que `ALLOW_PRIVATE_TARGETS=true`. El parseo de especificaciones usa `assertNoExternalRefs()` para bloquear `$ref` externos (vector de SSRF vía spec).

### 5.4 `assessments` — 7 endpoints ✅ Funcional

| Método | Ruta | Estado |
|---|---|---|
| GET | `/assessments` | ✅ |
| GET | `/assessments/dashboard` | ✅ métricas + tendencia de score (12 meses) + tendencia de hallazgos |
| GET | `/assessments/projects/:projectId` | ✅ paginado en servidor |
| GET | `/assessments/:id` | ✅ |
| POST | `/assessments/projects/:projectId/run` | ✅ DTO validado con rangos |
| DELETE | `/assessments/:id` | ✅ backend OK — **sin UI** |
| SSE | `/assessments/:id/progress` | ✅ con guard y verificación de propiedad |

`createAndRun` resuelve y congela la selección de plugins antes de encolar, y **rechaza IDs de plugin desconocidos con 400 antes de crear el job**. Los tres modos (`all` / `profile` / `manual`) están implementados.

El SSE tiene un timeout duro de 10 minutos por stream.

### 5.5 `issues` — 6 endpoints ✅ Funcional

Listado paginado con 8 filtros, estadísticas, detalle con historial de estados, ocurrencias por escaneo, cambio de estado con justificación, y asignación a un usuario.

`IssueLifecycleService` (453 líneas) es la pieza central. Contratos que implementa:

- **Fingerprint:** `SHA-256("v1|projectId|pluginId|ruleId|METHOD|normalizedRoute|component")`. Excluye `endpointId` a propósito, porque reimportar una spec recrea los endpoints con IDs nuevos.
- **Idempotencia:** `occurrenceKey = SHA-256(fingerprintVersion|fingerprint)` con índice único `(assessmentId, occurrenceKey)`. Se puede calcular antes de que exista fila alguna, así que sobrevive a los reintentos de BullMQ.
- **La ausencia no es una corrección.** Un issue solo se auto-resuelve si su check corrió hasta completarse. Si el plugin falló o expiró, el issue queda como "no testeado", nunca como "arreglado".

### 5.6 `scoring` — 4 endpoints ✅ Backend funcional · ❌ **cero consumo en la UI**

| Método | Ruta |
|---|---|
| GET | `/assessments/:id/score` |
| GET | `/projects/:id/posture` |
| GET | `/assessments/:id/comparison` |
| GET | `/assessments/:id/comparison/candidates` |

**`score-v2`** (`score-engine.ts`) es puro y determinista: sin reloj, sin base de datos, sin estado actual de los issues.

```
1. deduplicar por fingerprint
2. agrupar por (pluginId, ruleId)
3. tomar la severidad más alta del grupo
4. rulePenalty = pesoSeveridad × min(2.0, 1 + 0.25·log2(componentesDistintos))
5. score = 100 − Σ penalizaciones, con piso en 1 para un escaneo completado
```

Pesos: CRITICAL 40, HIGH 20, MEDIUM 8, LOW 2, **INFO 0** (lo informativo no es riesgo).

La unidad de penalización es la **regla**, no el fingerprint. Aplicado por fingerprint el multiplicador de exposición sería inerte (un fingerprint tiene exactamente un componente) y el score se saturaba a 0 con solo 4 endpoints críticos.

**Cobertura** se cuenta en *ejecuciones de plugin*, no en endpoints. Con `plannedChecks = 0` la cobertura es `null`, nunca 100%.

`ComparisonService` (397 líneas) compara dos escaneos con conciencia de alcance: distingue "arreglado" de "no se volvió a testear". **No tiene ninguna pantalla.**

### 5.7 `reports` — 8 endpoints ✅ Funcional (reescrito, sin commitear)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/reports/stats` | métricas + tendencia de vulnerabilidades |
| GET | `/reports` | solo la última versión de cada artefacto; `?includeHistory=true` |
| GET | `/reports/assessment/:id` | |
| GET | `/reports/assessment/:id/formats` | disponibilidad por formato — **sin UI** |
| POST | `/reports/assessment/:id/generate` | **idempotente**; `regenerate: true` crea versión+1 |
| GET | `/reports/:id/download` | solo lectura, jamás crea filas |
| GET | `/reports/:id` | |
| DELETE | `/reports/:id` | borra fila y artefacto en disco |

Este módulo fue reconstruido y es una mejora grande sobre el diseño anterior:

- Generación y descarga están **separadas**. Antes `GET /generate` renderizaba, insertaba una fila y transmitía los bytes; abrir un reporte y pulsar "Descargar" insertaba otra fila para el mismo escaneo, tipo y formato.
- Los reportes ya **no se regeneran desde datos mutables**. Cada uno guarda su `sourceSnapshot` congelado; la descarga sirve esos bytes. Los reportes históricos son reproducibles.
- Los PDFs se escriben a disco vía `ReportStorageService`, con validación del nombre de archivo y comprobación de contención dentro de `REPORTS_DIR`. Nada derivado de un request llega al sistema de archivos.
- Si Chromium falla, el snapshot HTML se conserva y el PDF se produce en la descarga. Un fallo de render nunca pierde el reporte.

Formatos: **PDF, HTML, JSON, SARIF, Markdown**. El PDF es el artefacto automático canónico tras cada escaneo.

⚠️ El PDF requiere un Chromium del sistema (`CHROMIUM_EXECUTABLE_PATH`). Funciona en esta máquina — los 4 PDFs en base de datos tienen entre 102 KB y 209 KB reales.

### 5.8 `plugins` + `profiles` — 13 endpoints ⚠️ Parcial

**Plugins:** listado, categorías, detalle, toggle por usuario, configuración por usuario, historial de ejecuciones, issues del plugin, y ejecución individual.
De estos ocho, **la UI solo usa dos**: listar y toggle.

`PluginRegistryService.onModuleInit()` sincroniza los plugins del código a la base de datos al arrancar — es la única fuente de verdad de qué está instalado.

**Perfiles:** listado, detalle, crear, actualizar, borrar. Los 6 perfiles de sistema (`full-scan`, `quick-scan`, `auth-audit`, `headers-audit`, `owasp-api-top10`, `compliance`) los siembra `ProfilesService.onModuleInit()`, no el seed.

⚠️ **`POST` y `PUT /plugins/profiles` no tienen DTO.** Usan tipos inline TS, que no llevan metadata de `class-validator`, así que el `ValidationPipe` global no los inspecciona y `ProfilesService.create()` tampoco valida contra el registro. Se pueden guardar IDs de plugin inexistentes. La propiedad sí se verifica y los perfiles de sistema son inmutables. El daño está acotado porque `createAndRun` rechaza IDs desconocidos antes de encolar — pero el usuario solo descubre el perfil roto al intentar usarlo.

### 5.9 `ai` — 9 endpoints ✅ Funcional, admin-only

Estado, configuración por proveedor, activación, test de conexión, borrado, desactivación global.

**5 proveedores + noop:** OpenAI, Claude (Anthropic), Gemini (Google), Grok (xAI), Ollama (local).

Cadena de resolución: **configuración en BD → variables de entorno → noop**. La configuración en BD permite reconfigurar en caliente sin reiniciar el contenedor; las claves se guardan cifradas.

El análisis de IA es un **post-procesador que nunca bloquea la finalización del escaneo**. Si el proveedor falla, se registra `aiMeta` con el motivo y el escaneo termina normal.

### 5.10 `audit` ⚠️ Infrautilizado

`AuditService` existe y funciona, pero solo lo llaman `auth` y `users`. El enum `AuditAction` declara `SCAN_START`, `SCAN_STOP`, `EXPORT`, `IMPORT`, `CREATE`, `UPDATE`, `DELETE` — ninguna de esas acciones se audita. La tabla tiene **0 filas**.

### 5.11 `finance` ❌ Directorio vacío

Existe `apps/api/src/modules/finance/` sin ningún archivo. No está registrado en `app.module.ts`. Residuo de una idea abandonada.

---

## 6. Motor de escaneo

### Plugins y reglas — 10 plugins, 38 reglas

| Plugin | OWASP | Categoría | Reglas |
|---|---|---|---|
| `bola` | API1:2023 | AUTHORIZATION | 1 |
| `broken-authentication` | API2:2023 | AUTHENTICATION | 2 |
| `jwt-analysis` | API2:2023 | AUTHENTICATION | 6 |
| `mass-assignment` | API3:2023 | AUTHORIZATION | 1 |
| `sensitive-data` | API3:2023 | COMPLIANCE | 10 |
| `rate-limit` | API4:2023 | PERFORMANCE | 2 |
| `bfla` | API5:2023 | AUTHORIZATION | 2 |
| `ssrf` | API7:2023 | INFRASTRUCTURE | 2 |
| `cors` | API8:2023 | HEADERS | 4 |
| `security-headers` | API8:2023 | HEADERS | 8 |

**Cobertura OWASP API Top 10 (2023): 7 de 10 categorías.**

Faltan por completo:
- **API6:2023** — Unrestricted Access to Sensitive Business Flows
- **API9:2023** — Improper Inventory Management
- **API10:2023** — Unsafe Consumption of APIs

El README y la pestaña *About* de la UI dicen "11 OWASP Plugins" y "Full API Top 10 2023 coverage". Ambas afirmaciones son **incorrectas**: son 10 plugins y 7/10 categorías.

`apps/api/src/modules/scanner/plugins/ai-analysis/` está vacío — el análisis de IA vive en el módulo `ai`, no como plugin.

### Pipeline de un escaneo (verificado en `scanner.processor.ts`)

```
POST /assessments/projects/:id/run
  ├─ valida proyecto READY, spec importada, endpoints > 0
  ├─ resuelve modo (all | profile | manual) → resolvedPlugins  [CONGELADO]
  ├─ rechaza IDs de plugin desconocidos (400)
  └─ encola en BullMQ con jobId determinista

ScannerProcessor.process()
  ├─ Assessment → RUNNING, progreso 0
  ├─ carga spec + endpoints + authConfig (descifra credenciales en memoria)
  ├─ upsert de AssessmentSummary  ← upsert, no create: sobrevive reintentos
  ├─ por cada plugin resuelto:
  │    ├─ PluginExecutorService.executeInPipeline()
  │    ├─ crea fila PluginExecution
  │    ├─ emite progreso (SSE) + escribe AssessmentLog
  │    └─ registra SUCCESS | FAILED | TIMEOUT
  ├─ AiService.analyzeFindings()  ← nunca bloquea
  ├─ IssueLifecycleService.persistScanResults()
  │    └─ fingerprint → dedup → crear/recurrir/reabrir/resolver/no-testeado
  ├─ actualiza contadores + cobertura en AssessmentSummary
  ├─ Assessment → COMPLETED
  ├─ ScoringService.scoreAssessment()  ← después de COMPLETED, a propósito
  └─ genera el PDF automáticamente (idempotente, en background)
```

**Manejo de fallos:** si algo lanza, el assessment pasa a `FAILED`, y el score se limpia explícitamente a `null` / `UNAVAILABLE`. Un escaneo fallido nunca deja una puntuación atrás.

---

## 7. Frontend

**19 páginas**, layout shell de shadcn `dashboard-01`, todo con tokens CSS (0 colores hardcodeados).

| Ruta | Líneas | Estado |
|---|---|---|
| `/` | 5 | ✅ redirect → `/dashboard` |
| `/login` `/register` | 197 / 289 | ✅ funcionales |
| `/auth/callback` | 89 | ✅ canje de sesión → JWT |
| `/dashboard` | 58 | ✅ 4 métricas, 3 gráficos, tabla reciente |
| `/projects` | 259 | ✅ listado + drawer de creación |
| `/projects/new` | 5 | ⚠️ redirect a `/projects` |
| `/projects/[id]` | 104 | ✅ endpoints + escaneos paginados + lanzar escaneo |
| `/projects/[id]/reports` | 56 | ✅ |
| `/assessments` | 178 | ✅ |
| `/assessments/[id]` | 126 | ✅ SSE en vivo + exportar 5 formatos |
| `/issues` | 194 | ✅ filtros severidad/estado + paginación |
| `/issues/[id]` | 243 | ⚠️ funcional, pero el triaje usa `window.prompt` |
| `/plugins` | 240 | ⚠️ solo listar y activar/desactivar |
| `/plugins/profiles` | 280 | ✅ CRUD completo |
| `/reports` | 309 | ✅ tabla, descarga, regenerar, borrar |
| `/reports/[id]` | 234 | ✅ |
| `/settings` | 583 | ⚠️ mixto — ver abajo |

### Estado de las pestañas de Settings

| Pestaña | Estado |
|---|---|
| General | ⚠️ **Falso.** El botón "Save changes" solo lanza un toast. Tema, zona horaria e idioma no persisten ni tienen backend. |
| Security | ✅ Cambio de contraseña real. Las "sesiones activas" están hardcodeadas a una entrada. |
| API Tokens | ✅ **Honestamente vacía.** Estado explícito de "no disponible" en vez de un gestor falso. Buena decisión. |
| Notifications | ⚠️ **Falso.** Solo estado de React; se pierde al recargar. Sin persistencia ni backend. |
| AI Configuration | ✅ Real, conectada a `aiApi`. |
| System | ⚠️ **Datos hardcodeados y desactualizados.** Dice "11 OWASP Plugins Active" (son 10) y marca SSRF como "Disabled" (está habilitado en BD). No lee de la API. |
| About | ⚠️ Repite el "11 plugins" y "Full API Top 10 coverage" incorrectos. |
| Users | ✅ Real, admin-only. |
| Audit Logs | ✅ Real (aunque la tabla está vacía porque casi nada se audita). |

### Directorios de ruta vacíos (15)

Estas carpetas existen sin `page.tsx`. No producen 404 porque nada enlaza a ellas, pero indican trabajo planeado y abandonado a medias:

```
projects/[projectId]/{api-definition, assessments, endpoints, findings, settings}
assessments/new
plugins/[pluginId], plugins/profiles/[id], plugins/run
settings/{about, ai, general, notifications, security, system}
```

También vacíos: `apps/web/src/lib/{api,queries,auth,constants}/` y `apps/web/src/components/profiles/`.

---

## 8. Superficie de backend sin frontend

Esto es lo más importante del reporte para planificar. **14 métodos del cliente API no tienen ni un solo consumidor en la UI**, verificado por grep sobre todo `apps/web/src`:

| Método del cliente | Endpoint | Qué se pierde |
|---|---|---|
| `scoringApi.assessmentScore` | `GET /assessments/:id/score` | El desglose del score por regla |
| `scoringApi.projectPosture` | `GET /projects/:id/posture` | La postura consolidada del proyecto |
| `scoringApi.compare` | `GET /assessments/:id/comparison` | **Toda la comparación de escaneos** |
| `scoringApi.comparisonCandidates` | `.../comparison/candidates` | Selector de línea base |
| `pluginsApi.get` | `GET /plugins/:id` | Página de detalle de plugin |
| `pluginsApi.getExecutions` | `GET /plugins/:id/executions` | Historial de ejecución |
| `pluginsApi.getIssues` | `GET /plugins/:id/issues` | Issues por plugin |
| `pluginsApi.saveConfig` | `PUT /plugins/:id/config` | Configuración por plugin |
| `pluginsApi.categories` | `GET /plugins/categories` | Filtro por categoría |
| `pluginsApi.run` | `POST /plugins/:id/run` | Ejecutar un plugin suelto |
| `issuesApi.stats` | `GET /issues/stats` | Panel de estadísticas de issues |
| `issuesApi.assign` | `PATCH /issues/:id/assignee` | **Asignar un issue a alguien** |
| `issuesApi.occurrencesByAssessment` | `GET /issues/occurrences/assessment/:id` | Ocurrencias por escaneo |
| `assessmentsApi.cancel` | `DELETE /assessments/:id` | **Cancelar un escaneo en curso** |
| `reportsApi.formats` | `.../formats` | Disponibilidad por formato |

Dos de estos duelen especialmente:

- **No hay forma de cancelar un escaneo desde la UI.** El backend lo soporta (quita el job de BullMQ y marca `CANCELLED`), pero ningún botón lo llama.
- **La comparación de escaneos no existe en la interfaz.** Son 397 líneas de lógica con conciencia de alcance —distingue "arreglado" de "no re-testeado"— completamente invisibles.

### Contrato de score no respetado en la UI

`/assessments/[id]` muestra `summary.securityScore ?? "—"` **sin mostrar el `scoreStatus`**. El componente `ScoreDisplay` existe y maneja correctamente `UNAVAILABLE` / `PROVISIONAL` / `FINAL`, pero solo se usa en la vista de reportes. Un score provisional (cobertura parcial) se presenta en la página de escaneo como si fuera definitivo — que es exactamente el defecto que el enum `ScoreStatus` fue creado para evitar.

---

## 9. Estado de seguridad

### Lo que está bien resuelto

- **Aislamiento por usuario correcto** en projects, assessments, issues, reports y profiles. Revisé las consultas; no encontré IDOR.
- **Credenciales cifradas** con AES-256-GCM (CBC eliminado). `ENCRYPTION_KEY` debe ser exactamente 64 caracteres hex; sin padding, truncado ni fallback silencioso. `validateEnv` y `CryptoService` comparten una única derivación.
- **Los secretos nunca vuelven al cliente**, ni siquiera cifrados (`stripAuthSecrets`).
- **Protección SSRF por defecto**: resolución DNS + rechazo de direcciones privadas; `ALLOW_PRIVATE_TARGETS` es opt-in explícito.
- **`$ref` externos bloqueados** al parsear especificaciones OpenAPI.
- **Path traversal imposible** en el storage de reportes: nombre validado + comprobación de contención en cada operación de E/S.
- **Rate limiting global** en tres ventanas (20/s, 100/10s, 500/min).
- **Helmet** activo; CSP solo en producción.
- Los reportes se sirven con `Cache-Control: private, no-store` y `X-Content-Type-Options: nosniff`.

### Lo que sigue abierto

| Hallazgo | Severidad | Detalle |
|---|---|---|
| JWT en `localStorage` | Media | Legible por cualquier XSS. Considerar cookie httpOnly. |
| Token JWT en query string del SSU | Media | Va a logs de acceso e historial del navegador. Limitación real de `EventSource`; mitigable con un token efímero de un solo uso. |
| Perfiles sin DTO ni validación de registro | Baja-Media | Se pueden persistir IDs de plugin inexistentes. |
| `saveAuth` con `@Body() any` | Baja | Está validado y filtrado a mano, correctamente — pero fuera del `ValidationPipe`. |
| Enlace de invitación en logs | Baja | Un token válido queda en el log. Desde 2026-08-11 es una decisión explícita: no hay transporte de correo y el enlace se devuelve al admin. |
| `PluginExecution.errorMessage` sin redactar | Baja | El mensaje crudo del plugin se persiste; puede arrastrar detalles del objetivo. |
| Casi nada se audita | Baja | Escaneos, exportaciones y cambios de proyecto no dejan rastro. |

---

## 10. Qué funciona — confirmado

- ✅ Registro, login (Better Auth + JWT), canje de sesión, invitaciones con expiración
- ✅ Creación de proyectos con asistente por pasos y borradores
- ✅ Importación de OpenAPI por URL y por contenido, con protección SSRF (371 endpoints importados)
- ✅ Configuración de autenticación del objetivo, cifrada en reposo
- ✅ Lanzamiento de escaneos en los 3 modos, con selección congelada
- ✅ 10 plugins ejecutándose, 38 reglas, con registro por ejecución
- ✅ Progreso en vivo por SSE con fallback a polling cada 3 s
- ✅ Persistencia idempotente de vulnerabilidades con identidad estable
- ✅ Ciclo de vida de issues: nuevo / recurrente / reabierto / resuelto / no-testeado
- ✅ Triaje con justificación obligatoria e historial completo
- ✅ Scoring `score-v2` determinista con explicación por regla
- ✅ Cobertura medida y separada de la puntuación
- ✅ Generación de reportes en 5 formatos, idempotente y versionada
- ✅ PDFs reales en disco (102–209 KB verificados)
- ✅ Descarga de solo lectura desde snapshot congelado
- ✅ 5 proveedores de IA conectables con reconfiguración en caliente
- ✅ Gestión de usuarios, roles e invitaciones
- ✅ Perfiles de escaneo (6 de sistema + personalizados)
- ✅ Dashboard con métricas reales y tendencias de 12 meses

---

## 11. Qué no funciona o está incompleto

### Bloqueante

| # | Problema | Impacto |
|---|---|---|
| 1 | **`lint:api` no puede ejecutarse** — falta `eslint.config.js` (ESLint 9) | El job de lint en CI falla siempre |
| 2 | **`test:e2e` apunta a `./test/jest-e2e.json`, que no existe** — tampoco existe el directorio `apps/api/test` | No hay tests end-to-end |
| 3 | **89 entradas sin commitear**, con trabajo funcional dentro | Riesgo real de pérdida |

### Alto

| # | Problema | Impacto |
|---|---|---|
| 4 | 3 tests fallando por fixtures desactualizados | La suite no está verde; enmascara regresiones futuras |
| 5 | No hay UI de comparación de escaneos | 397 líneas de backend invisibles |
| 6 | No hay botón de cancelar escaneo | Un escaneo colgado no se puede detener desde la UI |
| 7 | El score en `/assessments/[id]` no muestra su `scoreStatus` | Un score provisional se presenta como definitivo |
| 8 | Snapshot huérfano en `score-v1` conviviendo con `score-v2` | Comparaciones entre versiones incoherentes |
| 9 | Faltan 3 categorías OWASP (API6, API9, API10) | El claim de "cobertura completa" es falso |

### Medio

| # | Problema |
|---|---|
| 10 | Settings › General y Notifications simulan guardar y no persisten nada |
| 11 | Settings › System muestra datos hardcodeados y desactualizados (11 plugins, SSRF disabled) |
| 12 | README y About afirman "11 plugins" y "Full Top 10 coverage" — ambos incorrectos |
| 13 | Rebranding a "API Analyser" a medias: código sí, README y 1 test no |
| 14 | El triaje de issues usa `window.prompt` |
| 15 | `PluginExecution` sin `attemptCount`, `errorCode`, `skipReason` ni único `(assessmentId, pluginId)` — Fase 3 no arrancó |
| 16 | Cobertura y progreso todavía derivan del JSON `AssessmentSummary.pluginResults` en lugar de las filas `PluginExecution` |
| 17 | `ApiKey` en el esquema, sin controlador, sin servicio, 0 filas |
| 18 | `AuditLog` con 0 filas: escaneos, exportaciones y cambios de proyecto no se auditan |
| 19 | Perfiles de escaneo sin DTO ni validación contra el registro |
| 20 | Sin runner de tests de frontend (Vitest/RTL/jsdom) — postergado a propósito |
| 21 | El plugin de Next no está detectado en la config de ESLint del web |

### Bajo / limpieza

| # | Elemento |
|---|---|
| 22 | `apps/api/src/modules/finance/` — directorio vacío |
| 23 | `apps/api/src/modules/scanner/plugins/ai-analysis/` — directorio vacío |
| 24 | 15 directorios de ruta vacíos en `apps/web/src/app` |
| 25 | Archivos residuales: `apps/api/tmp-pptr2.ts`, `apps/web/probe-*.html`, `apps/web/reports-probe.html` |
| 26 | `ScannerProcessor.calculateSummary()` calcula una variable `score` que nunca se usa (código muerto de la fórmula vieja) |
| 27 | 3 warnings de variables sin usar en el lint del web |
| 28 | `Endpoint`, `AssetCriticality`, `OccurrenceValidation` sin superficie en la UI |

---

## 12. Deuda registrada de las fases anteriores

De `docs/API Analyser-INSPECTION-REPORT.md` y las notas de la reforma:

- Fases cerradas y aprobadas: **0** (seguridad), **1A** (esquema de dominio), **1B** (migración base), **1C** (reescritura de persistencia), **2** (scoring + comparación).
- **Fase 3 no ha comenzado.** Su alcance: convertir la selección congelada en un plan de ejecución completo, inmutable y auditable. Requiere evolucionar `PluginExecution` (no crear un modelo nuevo), añadir al snapshot `profileNameSnapshot`, `requestedPluginIds`, `registryVersion`, `configurationSnapshot`, `plannedChecks`, y hacer los modos explícitos: `ALL_ENABLED` / `PROFILE` / `SINGLE_PLUGIN`.
- Deuda diferida por fase: comparación → Fase 6 · reemplazo de `window.prompt` → Fase 5 · API tokens → Fase 7.

**Nota importante:** el trabajo sin commitear (artefactos de reporte, storage en disco, `score-v2`, branding) **no estaba en el plan de fases**. Se hizo después del cierre de la Fase 2 y por fuera de la secuencia. Es trabajo bueno, pero conviene commitearlo con su propia justificación antes de abrir la Fase 3.

---

## 13. Qué falta por desarrollar — orden sugerido

**Paso 0 — antes de tocar nada.** Commitear las 89 entradas en unidades revisables: (a) rebranding, (b) artefactos y storage de reportes + sus 2 migraciones, (c) `score-v2` + piso, (d) cambios de UI. Arreglar los 3 tests desactualizados en el mismo commit que la funcionalidad que los invalidó. Borrar los archivos residuales.

**Paso 1 — desbloquear el tooling.** Crear `apps/api/eslint.config.js` (flat config de ESLint 9) y arreglar o eliminar el script `test:e2e`. Sin esto, el CI no puede estar verde y ningún hallazgo automático es confiable.

**Paso 2 — corregir lo que miente.** Es un proyecto de ciberseguridad; una UI que afirma cobertura que no tiene es el peor defecto posible. Corregir README, About y System para decir 10 plugins y 7/10 categorías. Hacer que System lea de `GET /plugins` en vez de tener datos escritos a mano. Quitar o marcar como no disponibles las pestañas General y Notifications, siguiendo el mismo criterio honesto que ya se aplicó a API Tokens.

**Paso 3 — conectar el backend que ya existe.** Es el mejor retorno por esfuerzo del proyecto: 14 métodos ya implementados, testeados y sin consumir. Prioridad: botón de cancelar escaneo → `ScoreDisplay` con `scoreStatus` en la vista de escaneo → panel de estadísticas de issues → asignación de issues → página de detalle de plugin (`/plugins/[pluginId]`) → vista de comparación de escaneos.

**Paso 4 — Fase 3 según lo planeado.** Plan de ejecución inmutable, evolución de `PluginExecution`, migración de cobertura y progreso del JSON a las filas reales.

**Paso 5 — cerrar la cobertura OWASP.** Plugins para API6, API9 y API10. Solo después de esto el claim de "Top 10 completo" será cierto.

**Paso 6 — endurecer.** JWT a cookie httpOnly; token efímero para el SSE; DTO real para perfiles con validación contra el registro; auditoría de escaneos, exportaciones y cambios de proyecto; redacción de `errorMessage`.

**Paso 7 — completar lo prometido.** API Tokens (el modelo `ApiKey` lleva esperando desde el principio), preferencias de usuario reales, notificaciones con backend.

---

## 14. Comandos de referencia

```bash
docker compose up -d          # PostgreSQL + Redis
bun run db:migrate            # aplicar migraciones
bun run db:seed               # datos de demo
bun run db:studio             # Prisma Studio
bun dev                       # API :4000 + Web :3000

bun run --cwd apps/api test   # 391 tests (bun test, no Jest)
bun run --cwd apps/web test   # 23 tests
bunx tsc --noEmit             # typecheck (por app)
```

Documentación de la API en `http://localhost:4000/api/docs` (Swagger, solo fuera de producción).

**Advertencias operativas:**
- Nunca ejecutar `bun run build:web` ni borrar `.next` con un `bun dev` corriendo — rompe el servidor en vivo.
- Los tests corren con **`bun test`**, no con Jest. Node no está instalado en esta máquina.
- Los tests de integración usan una base `api_analyser_test` real creada desde la migración base.
- El login web requiere una cuenta de Better Auth (tabla `accounts`); los usuarios sembrados por Nest solo sirven para la API. Cuenta demo: `demo@apianalyser.local` / `Demo1234!`.
