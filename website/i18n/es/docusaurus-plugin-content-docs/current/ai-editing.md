---
id: ai-editing
title: Edición con IA
sidebar_position: 8
description: "Edita proyectos de OpenScreen con tu propio agente: Claude Code, Codex o cualquier cliente MCP inicia `openscreen mcp` y graba, edita, transcribe y exporta. Sin proveedor y sin clave en la app."
keywords:
  - edición de video con IA
  - editor de video con MCP
  - edición de video con Claude Code
  - edición de video con Codex
  - privacidad
---

# Edición con IA

OpenScreen no tiene un modelo propio, ni ninguno que conectar en la app. La edición con IA la hace un agente que ya usas, como Claude Code o Codex: inicia `openscreen mcp`, el servidor MCP de OpenScreen, y trabaja con sus herramientas. El agente inicia sesión con su propia cuenta, y OpenScreen nunca la ve. OpenScreen por sí mismo no envía nada a ningún modelo: lo que el agente lee a través de las herramientas, como el proyecto, la transcripción y los fotogramas, va al proveedor de ese agente, con tu cuenta en él. Los usos de la red que hace la propia app (la descarga de los modelos de transcripción, la búsqueda de actualizaciones) se enumeran en las [preguntas frecuentes](./faq.md#does-openscreen-work-offline).

:::tip
Nada de esto es obligatorio. La grabación, la edición, la transcripción, los subtítulos y la exportación funcionan sin cuenta y sin agente. De todo eso, solo la transcripción necesita una descarga, una única vez: sus [modelos](./captions.md#transcribing), en tu primer uso.
:::

:::note
Las versiones anteriores tenían un panel de chat en el editor, conectado a un proveedor de modelos con tu propia clave API, y un servidor MCP que se activaba en los ajustes de la app. Ambos se eliminaron, junto con las dos funciones que usaban esa clave: el botón **Traducir** del panel Subtítulos y **Cortes inteligentes** del menú **Mejora automática** de la línea de tiempo. Ahora tu propio agente hace esos trabajos con las herramientas que se describen aquí.
:::

## Configurarlo {#setting-it-up}

No hay nada que activar en la app: sin puerto, sin token, sin ajuste. El agente inicia el propio ejecutable de la app con `mcp` y se comunica con él por stdin y stdout, con tus permisos, como ejecutaría `openscreen record`. Así puede grabar tu pantalla, editar y exportar sin nada que autorizar en la app. La forma más rápida es pegar esto en tu agente de IA (Claude Code, Codex, Cursor…):

```text
Install the OpenScreen skills with `npx skills add getopenscreen/openscreen -y`, then follow openscreen-demo to make a demo video of this feature.
```

Las skills instalan OpenScreen si falta, una vez que aceptes. Instalada así, sin el plugin de abajo, la skill `openscreen-demo` agrega el servidor MCP de OpenScreen, y luego te pide que abras una nueva sesión y digas *continue the OpenScreen demo*: un agente solo obtiene herramientas nuevas en una nueva sesión. Para configurarlo a mano en cambio:

```bash
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

`<executable>` es el ejecutable de la app; el de cada sistema aparece en [Ejecutar la CLI](./cli.md#running-the-cli). Otros clientes, como Cursor, usan un servidor stdio con el ejecutable como `command` y `["mcp"]` como `args`.

Las skills también están disponibles como plugin, desde el marketplace del propio repositorio. En Claude Code:

```text
/plugin marketplace add getopenscreen/openscreen
/plugin install openscreen@openscreen
```

El plugin trae consigo el servidor MCP de OpenScreen: un pequeño script de Node encuentra la app instalada y la inicia con `mcp`, así que las herramientas están ahí después de `/reload-plugins` o en una nueva sesión, sin `claude mcp add`. Cuando no encuentra ninguna app utilizable, ofrece una sola herramienta, `openscreenSetup`, que dice qué comprobó y cómo configurar OpenScreen.

Para Codex y la app de escritorio de ChatGPT, que comparten sus plugins:

```bash
codex plugin marketplace add getopenscreen/openscreen
codex plugin add openscreen@openscreen
```

OpenScreen aparece entonces entre los plugins instalados de la app, con sus skills. Ahí, el servidor MCP se agrega con el comando `codex mcp add` de arriba.

## Qué puede hacer el agente {#what-the-agent-can-do}

Describe la edición con tus propias palabras: "corta el tiempo muerto de la introducción", "haz zoom cuando abro la terminal". El agente trabaja con operaciones reales de la línea de tiempo, y no con un nuevo renderizado: puede agregar y ajustar recortes, zooms, regiones de velocidad, anotaciones (texto, flechas y desenfoques que ocultan datos privados en pantalla), pistas de audio importadas con sus fundidos y segmentos de cámara a pantalla completa, agregar zooms automáticos en tus clics, editar los puntos de entrada y salida y el recorte de un clip, colocar el material de otra fuente, duplicar, reordenar o quitar clips, y leer la transcripción para encontrar aquello a lo que te refieres. También ajusta el aspecto del vídeo: fondo, margen, esquinas redondeadas, sombra, marco de dispositivo, formato, la disposición de la cámara, el cursor y el volumen general. Y puede escribir un efecto visual que los ajustes no ofrecen: consulta [Efectos personalizados](./effects.md).

Dos cosas que puedes pedirle en particular:

- **Cortar silencios y muletillas.** El agente lee la transcripción y corta esos tramos como recortes, que puedes arrastrar o eliminar como los tuyos. A mano, los cortas de uno en uno en la [transcripción](./captions.md#transcript-editing).
- **Traducir los subtítulos.** El editor no tiene botón de traducir. El agente lee las frases de los subtítulos, las traduce con su propio modelo y guarda el resultado como una capa de idioma junto a la transcripción: consulta [Traducción](./captions.md#translation). También puede activar los [subtítulos](./captions.md), darles estilo y colocarlos.

`transcribe` ejecuta Whisper en tu equipo sobre los medios de un proyecto, como hace el editor al abrir un proyecto.

El agente puede listar todos los proyectos y leer o editar cualquiera de ellos. Mientras OpenScreen está abierto, las herramientas actúan sobre el proyecto abierto en el editor, salvo que el agente indique otro. También puede crear un proyecto, vacío o a partir de un archivo de video, cambiarle el nombre a uno, y agregar un archivo de video, de audio o de imagen a los medios de un proyecto o quitar uno. Una imagen se agrega como un clip mudo de ella, de unos segundos. Eliminar un proyecto no está entre las herramientas: eso queda en tus manos, en la aplicación.

## Ediciones en vivo y deshacer {#live-edits-and-undo}

Cada edición se guarda en cuanto se aplica:

- **En el proyecto abierto en el editor**, mientras OpenScreen está abierto, el agente trabaja a través de la app. Una edición aparece en el editor al instante, y cada una es un solo paso de `Ctrl/Cmd + Z`, como una edición tuya. A los agentes se les indica que guarden un punto de restauración antes de una serie de ediciones, así que puedes pedirles que dejen el proyecto como estaba en un solo paso, que el propio `Ctrl/Cmd + Z` puede deshacer. Si la app no responde, las ediciones de ese proyecto se rechazan, porque el editor guardaría su propia copia encima.
- **En cualquier otro proyecto**, una edición se guarda en su archivo, fuera del alcance de `Ctrl/Cmd + Z`. El agente debe guardar un punto de restauración de ese proyecto antes de su primera edición, y volver a él es la única forma de deshacerla.

Los puntos de restauración se guardan en memoria. Mientras OpenScreen está abierto, duran hasta que lo cierres; si no, duran hasta que termina la sesión del agente. Solo se conservan los 20 puntos de restauración más recientes, así que uno más antiguo puede desaparecer antes.

## Dejar que un agente haga todo el video {#letting-an-agent-make-the-whole-video}

Un agente puede hacer un video completo por sí solo, desde la grabación hasta la exportación. Además de las herramientas de edición, `openscreen mcp` le da `listSources`, `startRecording`, `stopRecording`, `setPointerTrack`, `exportVideo`, `exportAudio`, `exportCaptions`, `getFrames`, `getContactSheet`, `getBeforeAfter`, `getAudioReport` y `createProject`. Una toma también puede grabar tu cámara web y el cursor propio del sistema, como la barra de grabación, y una exportación acepta las opciones del diálogo de exportación: calidad y velocidad de fotogramas para un MP4; velocidad de fotogramas, tamaño y bucle para un GIF. `exportAudio` escribe el audio del proyecto, o una sola pista importada (una voz en off agregada con `importMedia` y `addAudio`), en un WAV o un M4A, exactamente como lo mezcla el MP4. `exportCaptions` escribe los subtítulos en un archivo SRT o WebVTT, sincronizado con el video exportado.

El agente también revisa su propio trabajo. `getFrames` muestra momentos elegidos de un video, o un tramo de `startSec` a `endSec`, y con una `region` solo esa parte de la imagen, a la resolución propia del video, para leer texto pequeño. `getContactSheet` reúne muchos momentos en una sola imagen, cada uno con su tiempo: el ritmo de todo el video, o un zoom fotograma a fotograma. `getBeforeAfter` muestra los mismos momentos antes y después de una serie de ediciones, lado a lado, y dice dónde cambió la imagen. `getAudioReport` mide la sonoridad, el pico real y los silencios del sonido de un proyecto. Entre las herramientas de edición, `listStylePresets` y `applyStylePreset` le dan a un proyecto el aspecto de uno de los **Preajustes** en una sola edición.

- **Cada toma se convierte en un proyecto nuevo** en tu lista de proyectos, con zooms en sus clics, como una grabación hecha en la app: los clics cercanos en el tiempo y en la pantalla comparten un zoom, y los primeros segundos y el final se quedan en la pantalla completa. Cada edición del agente se guarda en el archivo del proyecto, y se deshace con el punto de restauración que toma el agente: consulta [Ediciones en vivo y deshacer](#live-edits-and-undo).
- **Una toma no tiene transcripción hasta que el agente la pide.** Llama a `transcribe` antes de cortar palabras o de activar los subtítulos. Whisper se ejecuta en tu equipo, dentro de OpenScreen cuando está abierto.
- **Una toma controlada por un script** (Playwright, por ejemplo) nunca mueve el puntero de la pantalla. El agente le pasa a OpenScreen su propio registro de las acciones con `setPointerTrack`, y el video obtiene igualmente un cursor y sus zooms.
- **Las skills** le enseñan el trabajo a un agente. `openscreen-demo` lo lleva desde el storyboard hasta el video terminado, y después adjunta el video a un pull request, para que los revisores vean el cambio ahí mismo, o redacta un post en X que solo publica cuando dices que sí. Otras seis profundizan cada una en un paso: `openscreen-capture` (una toma limpia y repetible, incluida una página web grabada sin ninguna ventana), `openscreen-motion` (zooms, anotaciones y ritmo), `openscreen-effects` (efectos personalizados), `openscreen-sound` (narración, música y sonoridad), `openscreen-review` (la revisión antes de que el video salga) y `openscreen-deliver` (formato, tamaño y entrega del video). Agrégalas todas con `npx skills add getopenscreen/openscreen`. Están en [`plugin/skills/`](https://github.com/getopenscreen/openscreen/tree/main/plugin/skills).
