# API Analyser (IASA) — Brand assets v1.0

Símbolo: apertura de 6 aspas (inspección / lente) + red de 6 nodos (endpoints descubiertos) + núcleo hexagonal con destello de 4 puntas (análisis asistido por IA).

## Paleta
| Nombre  | HEX      | Uso |
|---------|----------|-----|
| Ink     | #0A0A0B  | Tinta sobre fondo claro |
| Canvas  | #08080A  | Fondo oscuro |
| White   | #FFFFFF  | Fondo claro / tinta sobre oscuro |
| Violet  | #6D4BFF  | Núcleo — inicio del gradiente |
| Indigo  | #5566FF  | Transición |
| Blue    | #2E8BF5  | Acento primario / links |
| Cyan    | #1FC2E8  | Nodos / CTA |
| Ice     | #9BE4F7  | Highlight / hover |

Gradiente del núcleo: `linear-gradient(135deg, #6D4BFF 0%, #2E8BF5 45%, #1FC2E8 100%)`
Nodos sobre fondo claro: `#0F9DC4`

Tipografía: **Inter** — SemiBold (600) para el wordmark.

## Carpetas
- `01-mark/` — símbolo (2048 px): con fondo, transparente, monocromo y compacto
- `02-lockup/` — símbolo + "API Analyser", horizontal y vertical
- `03-app-icon/` — rounded-square 1024 y 512
- `04-favicon/` — 16 a 256 px
- `05-svg/` — vectores editables

## Versión compacta
Bajo 64 px la red de nodos se vuelve ruido. Usar `mark-compact-*` (solo aspas + núcleo) para favicon, avatares y badges.

## Reglas
- Área de resguardo: 0.25 × el ancho del símbolo por lado.
- Tamaño mínimo: 32 px pantalla / 10 mm impreso.
- El gradiente vive solo en el núcleo; aspas siempre en tinta sólida.
- No rotar el hexágono, no invertir el giro de las aspas, no aplicar gradiente al wordmark.
