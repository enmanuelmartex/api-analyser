# API Analyser — Guía de la aplicación

Contexto de arquitectura: qué hace cada sección, de dónde saca sus datos y qué debe mostrar.

**Stack:** monorepo con `apps/web` (Next.js App Router · TypeScript · Tailwind · shadcn/ui) y `apps/api` (NestJS · Prisma · BullMQ · Redis). La API de negocio cuelga de `/api/v1`; Better Auth de `/api/auth`.

---

## Índice

1. [Qué es API Analyser](#qué-es-api_analyser)
2. [El flujo central](#el-flujo-central)
3. [Mapa de secciones](#mapa-de-secciones)
4. [Dashboard](#dashboard) · [Projects](#projects) · [Assessments](#assessments) · [Findings](#findings) · [Reports](#reports) · [Finance](#finance) · [Plugins](#plugins) · [Settings](#settings) · [Autenticación](#autenticación-y-roles)
5. [Modelo de datos](#modelo-de-datos)
6. [Vocabulario de estados](#vocabulario-de-estados)
7. [Huecos detectados](#huecos-detectados)

---

## Qué es API Analyser

El producto responde a una pregunta: **¿qué vulnerabilidades tiene esta API REST?** Todo lo demás existe para alimentar esa pregunta o para explotar su respuesta.

El usuario registra un **proyecto** (una API con su URL base y su spec OpenAPI), lanza un **assessment** (una ejecución del escáner) y obtiene **findings** (vulnerabilidades concretas en endpoints concretos) que puede triar y exportar como **reports**.

Las secciones de la barra lateral no son módulos independientes: son *vistas sobre distintas etapas del mismo pipeline*. Findings no es otra cosa que Assessments visto al nivel de detalle de la vulnerabilidad individual.

---

## El flujo central

Única secuencia real del sistema. Cada paso deja registro en base de datos y alimenta la siguiente sección de la interfaz.

**1. Alta del proyecto (3 pasos).** Un asistente en `ProjectDrawer` guarda un borrador tras cada paso: datos básicos (nombre, URL base, entorno) → importación de la spec OpenAPI (URL o subida) → configuración de autenticación. El proyecto vive como `DRAFT` con `setupStep` 1–3 hasta que se finaliza y pasa a `READY`.

**2. Parseo de la especificación.** La spec se valida con `swagger-parser` y se descompone en registros `Endpoint` (método + ruta + tags). Esos endpoints son la superficie de ataque.

**3. Ejecución del assessment.** `POST /assessments/projects/:id/run` encola un job en BullMQ. El worker (`scanner.processor.ts`) avanza por fases — `Initializing`, `Parsing`, ejecución de plugins, `Saving Results`, `Completed` — publicando progreso que el front consume por SSE.

**4. Ejecución de plugins.** Cada plugin habilitado prueba los endpoints y emite hallazgos. Se puede correr todo el catálogo, un perfil guardado o una selección manual. Opcionalmente, un proveedor de IA enriquece los resultados.

**5. Resultados y resumen.** Se persisten los `Finding` y un `AssessmentSummary` agregado: conteos por severidad, endpoints probados, *security score*, nivel de riesgo y cobertura OWASP.

**6. Informe.** El escáner genera un informe automáticamente al terminar (`autoGenerateReport`); el usuario puede pedir más bajo demanda en otros formatos y para otras audiencias.

---

## Mapa de secciones

La navegación se define en un único sitio: `apps/web/src/components/navigation/nav-data.ts`, que exporta seis destinos principales y dos grupos plegables. Los helpers `isLeafActive` / `isGroupActive` resuelven el estado activo, incluido el caso de Settings, donde cada entrada es una pestaña en el query string.

| Sección | Ruta | Responde a |
|---|---|---|
| Dashboard | `/dashboard` | ¿Cómo está mi postura de seguridad global? |
| Projects | `/projects` | ¿Qué APIs tengo bajo vigilancia? |
| Assessments | `/assessments` | ¿Qué escaneos se han ejecutado y cómo fueron? |
| Findings | `/findings` | ¿Qué vulnerabilidades concretas hay que arreglar? |
| Reports | `/reports` | ¿Qué puedo entregar a dirección o a auditoría? |
| Finance | `/finance` | ¿Cuánto me cuesta el análisis con IA? |
| Plugins | `/plugins` | ¿Qué comprueba el escáner y cómo lo configuro? |
| Settings | `/settings` | Cuenta, seguridad, IA, usuarios y auditoría. |

---

## Dashboard

**Ruta:** `/dashboard`
**API:** `GET /assessments/dashboard`
**Modelos:** `Assessment` · `AssessmentSummary` · `Finding` · `Project`

La portada. Agrega el estado de *todos* los proyectos en una pantalla para responder «¿tengo algo ardiendo ahora mismo?» sin navegar. Única vista que se refresca sola: `refetchInterval` de 30 s.

**Qué muestra:** tarjetas de métricas (hallazgos críticos que requieren atención inmediata, proyectos activos, escaneos), gráficas de evolución y distribución por severidad, y `RecentAssessmentsTable` con los últimos escaneos y acceso al detalle.

> Es la única tabla que no pasa por el wrapper `DataTable`: vive dentro de una `Card` y usa los primitivos directamente. Por eso su `TableHeader` lleva `bg-card` explícito.

---

## Projects

**Rutas:** `/projects` · `/projects/new` · `/projects/[projectId]` · `/projects/[projectId]/reports`
**API:** `GET /projects` · `GET /projects/:id` · `POST /projects` · `POST /projects/drafts` · `PUT /projects/:id/draft` · `POST /projects/:id/finalize` · `PUT /projects/:id` · `DELETE /projects/:id` · `POST /projects/:id/spec/url` · `POST /projects/:id/spec/upload` · `POST /projects/:id/auth`
**Modelos:** `Project` · `ApiSpec` · `AuthConfig` · `Endpoint` · `ProjectSecret`

El inventario de APIs bajo vigilancia y el punto de entrada de todo lo demás: sin proyecto no hay escaneo. Un proyecto agrupa URL base, entorno, spec OpenAPI, configuración de autenticación e historial de assessments.

**Qué muestra:** rejilla de tarjetas con nombre, descripción, URL base, número de escaneos, última actualización, badge de entorno y acceso «Ver». Los proyectos incompletos muestran «Paso N de 3» y un enlace para continuar la configuración en lugar del acceso normal.

Filtra por nombre y por URL/descripción, permite multi-selección de entorno (incluido el pseudo-entorno «Draft o incompleto») y ordena por recientes, nombre o número de hallazgos. El estado vive en la URL, así que es compartible y sobrevive al refresh. Paginación de 12 por página.

### Un matiz sobre el asistente

`ProjectDrawer` nació como asistente de borradores y autoguarda contra `PUT /:id/draft`, endpoint que la API rechaza en cuanto el proyecto es `READY` (`"Only drafts can be autosaved."`). Al reutilizarlo para editar proyectos finalizados hubo que enrutar el guardado: los `DRAFT` siguen por autosave, los `READY` van por `PUT /projects/:id`, que no acepta `setupStep`.

---

## Assessments

**Rutas:** `/assessments` · `/assessments/[assessmentId]`
**API:** `GET /assessments` · `GET /assessments/:id` · `POST /assessments/projects/:projectId/run` · `DELETE /assessments/:id` · `GET /assessments/:id/progress` *(SSE)*
**Modelos:** `Assessment` · `AssessmentConfig` · `AssessmentSummary` · `AssessmentLog` · `Finding`

El historial de ejecuciones del escáner. Cada fila es una corrida contra un proyecto en un momento dado. Responde «¿mejoró o empeoró esta API desde el último escaneo?».

**Qué muestra:** tabla con proyecto y URL base, estado, *security score*, conteos de críticos y altos, total de hallazgos, duración y momento de inicio. Refresco cada 10 s para reflejar escaneos en curso.

El detalle añade progreso en vivo por SSE, los logs de la ejecución (`AssessmentLog`), el desglose del resumen y los hallazgos de esa corrida.

**Filtros:** texto sobre nombre de proyecto o URL, estado multi-selección, rango de duración y rango de fechas de inicio. Cada uno es un control independiente cuyo trigger muestra lo aplicado sin abrirlo; los activos aparecen como chips retirables.

---

## Findings

**Rutas:** `/findings` · `/findings/[findingId]`
**API:** `GET /findings` · `GET /findings/stats` · `GET /findings/:id` · `PATCH /findings/:id/status`
**Modelos:** `Finding` · `Endpoint` · `Assessment` · `Project`

El nivel de detalle donde se trabaja de verdad: la vulnerabilidad individual, atada a un endpoint concreto y a una categoría OWASP. Es la cola de trabajo del equipo de seguridad, agregada a través de todos los proyectos.

**Qué muestra:** tabla con severidad, título y proyecto de origen, endpoint (método + ruta), categoría OWASP, CVSS, estado de triaje y fecha de detección. Al pulsar una fila se abre un `Sheet` lateral con descripción, impacto, remediación y botones para cambiar el estado sin salir del listado.

El **triaje** es la función distintiva de esta sección: un hallazgo no solo se lee, se clasifica. Eso es lo que convierte una lista de alertas en un flujo de trabajo.

> A diferencia de Projects y Assessments, sus filtros de severidad y estado **consultan al servidor**: alimentan el `queryKey` de React Query y viajan como parámetros a `findingsApi.list()`, que acepta un único valor por campo.

---

## Reports

**Rutas:** `/reports` · `/reports/[reportId]` · `/projects/[projectId]/reports`
**API:** `GET /reports` · `GET /reports/stats` · `GET /reports/:id` · `DELETE /reports/:id` · `GET /reports/assessment/:assessmentId` · `GET /reports/assessment/:assessmentId/generate`
**Modelos:** `Report` · `Assessment` · `AssessmentSummary`

La capa de entrega: convierte resultados técnicos en documentos para audiencias distintas. Un mismo assessment produce informes diferentes según a quién van dirigidos.

| Tipo | Para quién |
|---|---|
| `EXECUTIVE` | Dirección — riesgo y postura general, sin detalle técnico |
| `TECHNICAL` | Equipo de seguridad — hallazgos completos con evidencia |
| `COMPLIANCE` | Auditoría — cobertura frente al marco de referencia |
| `DEVELOPER` | Quien corrige — endpoint, reproducción y remediación |

**Formatos:** `PDF` · `HTML` · `MARKDOWN` · `JSON` · `SARIF`

> La presencia de **SARIF** es significativa: es el estándar que consumen GitHub Code Scanning y herramientas de CI, así que habilita integrar API Analyser en un pipeline.

---

## Finance

> **⚠ Esta sección no funciona: no tiene backend.**

**Ruta:** `/finance`
**API:** `GET /finance/summary` → **404** · `GET /finance/usage` → **404**
**Modelos:** ninguno implementado

Su propósito es el control de coste del análisis con IA: cuánto se ha gastado por proyecto, proveedor y modelo, en tokens y en dólares. Responde a que la IA se paga por uso y puede dispararse sin vigilancia.

La página llama a `financeApi.summary()` y `financeApi.usage()`, pero **esos endpoints no existen**. El directorio `apps/api/src/modules/finance/` está vacío, no hay controlador de finance registrado al arrancar la API, y no existe mención alguna a «finance» en el backend. Verificado en vivo: `GET /api/v1/finance/summary` devuelve 404.

**Qué debería mostrar:** resumen de gasto agregado y desglose por ejecución con proveedor, modelo, tokens consumidos y coste estimado en USD. La interfaz ya está construida; falta persistir el consumo y exponer los dos endpoints. `AiProviderConfig` ya existe como punto de partida.

---

## Plugins

**Rutas:** `/plugins` · `/plugins/profiles`
**API:** `GET /plugins` · `GET /plugins/categories` · `GET /plugins/:id` · `PUT /plugins/:id/toggle` · `PUT /plugins/:id/config` · `GET /plugins/:id/executions` · `GET /plugins/:id/findings` · `POST /plugins/:id/run` · CRUD en `/plugins/profiles`
**Modelos:** `Plugin` · `PluginUserConfig` · `PluginExecution` · `ScanProfile`

El motor de detección, expuesto como configuración. Cada plugin es una comprobación de seguridad independiente; el catálogo determina qué sabe encontrar el escáner.

Hay **10 plugins integrados** en `apps/api/src/modules/scanner/plugins/`, que se registran y sincronizan con la base de datos al arrancar la API:

| Plugin | Qué detecta |
|---|---|
| `bola` | Broken Object Level Authorization — acceso a objetos de otros usuarios |
| `bfla` | Broken Function Level Authorization — acceso a funciones sin privilegio |
| `broken-authentication` | Fallos en el mecanismo de autenticación |
| `jwt-analysis` | Debilidades en la emisión y validación de JWT |
| `mass-assignment` | Asignación masiva de propiedades no previstas |
| `sensitive-data` | Exposición de datos sensibles en respuestas |
| `ssrf` | Server-Side Request Forgery |
| `rate-limit` | Ausencia o debilidad de limitación de peticiones |
| `security-headers` | Cabeceras de seguridad ausentes o mal configuradas |
| `cors` | Políticas CORS permisivas |

El enum `PluginCategory` declara doce categorías — `AUTHENTICATION`, `AUTHORIZATION`, `HEADERS`, `INJECTION`, `API_DESIGN`, `PERFORMANCE`, `INFRASTRUCTURE`, `COMPLIANCE`, `AI`, `CLOUD`, `GRAPHQL`, `GRPC` — bastantes más de las que los 10 plugins cubren. El esquema está preparado para crecer hacia GraphQL, gRPC y cloud.

### Perfiles de escaneo

`ScanProfile` guarda conjuntos reutilizables de plugins. Sirve para no correr el catálogo entero cada vez: un perfil «solo autorización» para iterar rápido, uno completo antes de producción. Al lanzar un assessment se elige entre todo el catálogo, un perfil o una selección manual (`AssessmentConfig.executionMode`: `all` | `profile` | `manual`).

---

## Settings

**Ruta:** `/settings?tab=…` (una sola ruta, nueve pestañas por query string)
**API:** `GET /auth/me` · `/users/*` · `/ai/config/*`
**Modelos:** `User` · `ApiKey` · `Invitation` · `AiProviderConfig` · `AuditLog`

| Pestaña | Contenido |
|---|---|
| `general` | Perfil del usuario y datos públicos |
| `security` | Contraseña y preferencias de seguridad |
| `tokens` | Claves de API para uso programático (`ApiKey`) |
| `notifications` | Preferencias de aviso |
| `ai` | Proveedores de IA: alta, activación, prueba de conexión y borrado |
| `system` | Estado del sistema |
| `about` | Versión e información del producto |
| `users` | **Admin.** Alta, invitación, rol, estado y reseteo de contraseña |
| `audit-logs` | **Admin.** Registro de acciones sobre la plataforma |

Las dos últimas solo aparecen para administradores, mediante la bandera `adminOnly` de `nav-data.ts`.

### Configuración de IA

Soporta varios proveedores con uno activo a la vez. Al arrancar se inicializan OpenAI (`gpt-4o-mini`) y Ollama (`llama3` en local). La pestaña permite probar la conexión antes de activar y desactivar todos de golpe — el análisis con IA es opcional dentro del assessment, no un requisito.

---

## Autenticación y roles

**Rutas:** `/login` · `/register` · `/accept-invite` · `/auth/callback`
**API:** `POST /auth/register` · `POST /auth/login` · `POST /auth/exchange-session` · `GET /auth/me` · `GET /users/verify-invite` · `POST /users/accept-invite`
**Modelos:** `User` · `Session` · `Account` · `Verification` · `Invitation` · `ApiKey`

Las páginas de autenticación viven fuera del layout del dashboard, en su propio grupo de rutas, y son las únicas que conservan el fondo con retícula y resplandor de marca.

El esquema (`Session`, `Account`, `Verification`) corresponde a **Better Auth**, y `exchange-session` canjea esa sesión por el JWT que consume la API de Nest. De ahí que existan dos espacios de rutas: `/api/auth` para Better Auth y `/api/v1` para la API de negocio.

El acceso se controla por rol (`Role`) y la incorporación es por invitación: un administrador invita, el destinatario verifica el token y acepta creando su cuenta.

---

## Modelo de datos

Veintitrés modelos en Prisma. Agrupados por su papel en el pipeline se leen mucho mejor que en orden alfabético:

| Grupo | Modelos | Papel |
|---|---|---|
| Identidad | `User` `Session` `Account` `Verification` `Invitation` `ApiKey` | Quién entra y con qué permisos |
| Objetivo | `Project` `ProjectSecret` `ApiSpec` `AuthConfig` `Endpoint` | Qué API se analiza y cómo se accede |
| Ejecución | `Assessment` `AssessmentConfig` `AssessmentSummary` `AssessmentLog` | Una corrida del escáner y su traza |
| Resultado | `Finding` `Report` | Lo encontrado y su entrega |
| Motor | `Plugin` `PluginUserConfig` `PluginExecution` `ScanProfile` | Qué comprobaciones existen y cómo se agrupan |
| Transversal | `AiProviderConfig` `AuditLog` | Proveedores de IA y trazabilidad |

> **Relación clave:** los hallazgos cuelgan del assessment, no del proyecto (`Finding → Assessment → Project`). **No existe relación directa entre `Project` y `Finding`**, así que cualquier métrica de hallazgos por proyecto hay que derivarla atravesando sus assessments. Es exactamente lo que hace `projects.service.ts → findAll()` para calcular `findingsCount`.

---

## Vocabulario de estados

Los enums son el lenguaje compartido entre backend e interfaz. Estos cuatro aparecen por toda la aplicación, en badges, filtros y columnas.

**Severidad del hallazgo:** `CRITICAL` · `HIGH` · `MEDIUM` · `LOW` · `INFO`

**Estado del assessment:** `PENDING` → `QUEUED` → `RUNNING` → `COMPLETED`, con `FAILED` y `CANCELLED` como finales alternativos. Los tres primeros son estados en vuelo: la interfaz refresca mientras haya alguno activo.

**Estado de triaje del hallazgo:** `OPEN` es el punto de partida. Desde ahí el equipo lo mueve a `CONFIRMED`, `FALSE_POSITIVE`, `RESOLVED` o `ACCEPTED_RISK`. Los dos últimos cierran sin arreglar: uno porque se corrigió, otro porque se decidió convivir con el riesgo.

**Estado del proyecto:** `DRAFT` con `setupStep` 1–3 mientras se completa el asistente, y `READY` una vez finalizado. Solo los `READY` pueden escanearse.

---

## Huecos detectados

Cosas que salieron al recorrer el código y conviene tener presentes.

- **Finance no tiene backend.** La interfaz está terminada pero sus dos endpoints devuelven 404 y el módulo de la API está vacío. Es el hueco más grande.
- **El catálogo de plugins va por detrás del esquema.** Doce categorías declaradas, incluidas `GRAPHQL`, `GRPC`, `CLOUD` e `INJECTION`, frente a diez plugins que cubren solo una parte.
- **La aplicación mezcla idiomas.** Projects está en español; Dashboard, Assessments, Findings, Reports y Settings en inglés. Conviene decidir uno e introducir i18n en lugar de traducir vista por vista.
- **Findings filtra en servidor y el resto en cliente.** Es la única sección cuyos filtros viajan a la API, y solo admite un valor por campo, lo que impide multi-selección sin tocar el backend o mover el filtrado al navegador.
- **`lastScanStatus` quedó sin consumidor.** Se añadió a la respuesta de `GET /projects` para un filtro por estado de escaneo que después se retiró del diseño.
