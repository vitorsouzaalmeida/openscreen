---
id: ai-editing
title: Montage par IA
sidebar_position: 8
description: "Monter vos projets OpenScreen avec votre propre agent : Claude Code, Codex ou tout client MCP lance `openscreen mcp` et enregistre, monte, transcrit et exporte. Ni fournisseur ni clé dans l'application."
keywords:
  - montage vidéo par IA
  - éditeur vidéo MCP
  - montage vidéo avec Claude Code
  - montage vidéo avec Codex
  - confidentialité
---

# Montage par IA

OpenScreen n'a pas de modèle à lui, et aucun à connecter dans l'application. Le montage par IA est fait par un agent que vous utilisez déjà, comme Claude Code ou Codex : il lance `openscreen mcp`, le serveur MCP d'OpenScreen, et travaille avec ses outils. L'agent se connecte avec son propre compte, et OpenScreen ne le voit jamais. OpenScreen lui-même n'envoie rien à aucun modèle : ce que l'agent lit par les outils, comme le projet, la transcription et des images fixes, part chez le fournisseur de cet agent, sous votre compte chez lui. Les usages du réseau propres à l'application (téléchargement des modèles de transcription, vérification des mises à jour) sont listés dans la [FAQ](./faq.md#does-openscreen-work-offline).

:::tip
Rien de tout cela n'est obligatoire. L'enregistrement, le montage, la transcription, les sous-titres et l'export fonctionnent tous sans compte et sans agent. Parmi eux, seule la transcription exige un téléchargement, une seule fois : ses [modèles](./captions.md#transcribing), lors de votre première transcription.
:::

:::note
Les versions précédentes avaient un panneau de discussion dans l'éditeur, connecté à un fournisseur de modèle avec votre propre clé API, et un serveur MCP à activer dans les réglages de l'application. Les deux ont été supprimés, ainsi que les deux fonctions qui utilisaient cette clé : le bouton **Traduire** du panneau Sous-titres et **Coupes intelligentes** dans le menu **Amélioration auto** de la timeline. Votre propre agent fait désormais ce travail avec les outils décrits ici.
:::

## Mise en place {#setting-it-up}

Il n'y a rien à activer dans l'application : ni port, ni jeton, ni réglage. L'agent lance l'exécutable même de l'application avec `mcp` et lui parle par stdin et stdout, avec vos droits, comme il lancerait `openscreen record`. Il peut donc enregistrer votre écran, monter et exporter sans rien avoir à autoriser dans l'application. Le plus rapide est de coller ceci dans votre agent IA (Claude Code, Codex, Cursor…) :

```text
Install the OpenScreen skills with `npx skills add getopenscreen/openscreen -y`, then follow openscreen-demo to make a demo video of this feature.
```

Les skills installent OpenScreen s'il manque, une fois que vous avez accepté. Installée de cette façon, sans le plugin ci-dessous, la skill `openscreen-demo` ajoute le serveur MCP d'OpenScreen, puis vous demande d'ouvrir une nouvelle session et de dire *continue the OpenScreen demo* : un agent n'obtient de nouveaux outils que dans une nouvelle session. Pour tout configurer à la main à la place :

```bash
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

`<executable>` est l'exécutable de l'application, indiqué pour chaque système dans [Lancer la CLI](./cli.md#running-the-cli). Les autres clients, Cursor par exemple, prennent un serveur stdio avec l'exécutable pour `command` et `["mcp"]` pour `args`.

Les skills existent aussi sous forme de plugin, depuis le marketplace du dépôt lui-même. Dans Claude Code :

```text
/plugin marketplace add getopenscreen/openscreen
/plugin install openscreen@openscreen
```

Le plugin apporte avec lui le serveur MCP d'OpenScreen : un petit script Node trouve l'application installée et la lance avec `mcp`, si bien que les outils sont là après `/reload-plugins` ou dans une nouvelle session, sans `claude mcp add`. Quand il ne trouve aucune application utilisable, il sert un seul outil, `openscreenSetup`, qui dit ce qu'il a vérifié et comment mettre OpenScreen en place.

Pour Codex et l'application de bureau ChatGPT, qui partagent leurs plugins :

```bash
codex plugin marketplace add getopenscreen/openscreen
codex plugin add openscreen@openscreen
```

OpenScreen apparaît ensuite parmi les plugins installés de l'application, avec ses skills. Là, le serveur MCP s'ajoute avec la commande `codex mcp add` ci-dessus.

## Ce que l'agent peut faire {#what-the-agent-can-do}

Décrivez la modification en langage courant : « coupe les temps morts de l'intro », « zoome quand j'ouvre le terminal ». L'agent travaille avec de vraies opérations de timeline, pas avec un nouveau rendu : il peut ajouter et ajuster des coupes, des zooms, des régions de vitesse, des annotations (texte, flèches et flous qui masquent une information privée à l'écran), des pistes audio importées avec leurs fondus, et des segments Caméra plein écran, ajouter des zooms automatiques sur vos clics, modifier les points d'entrée et de sortie et le recadrage d'un clip, placer les images d'une autre source, dupliquer, réordonner ou retirer des clips, et lire la transcription pour trouver ce dont vous parlez. Il règle aussi l'apparence de la vidéo : fond, marge, coins arrondis, ombre, cadre d'appareil, format, disposition de la caméra, curseur et volume général. Et il peut écrire un effet visuel que les réglages n'offrent pas : voir [Effets personnalisés](./effects.md).

Deux choses à lui demander en particulier :

- **Couper les silences et les mots de remplissage.** L'agent lit la transcription et retire ces passages par des coupes, que vous pouvez faire glisser ou supprimer comme les vôtres. À la main, vous les coupez un par un dans la [transcription](./captions.md#transcript-editing).
- **Traduire les sous-titres.** L'éditeur n'a pas de bouton de traduction. L'agent lit les phrases des sous-titres, les traduit avec son propre modèle, et enregistre le résultat comme couche de langue à côté de la transcription : voir [Traduction](./captions.md#translation). Il peut aussi activer les [sous-titres](./captions.md), les styliser et les placer.

`transcribe` lance Whisper en local sur les médias d'un projet, comme le fait l'éditeur à l'ouverture d'un projet.

L'agent peut lister tous les projets et lire ou modifier n'importe lequel. Tant qu'OpenScreen est ouvert, les outils agissent sur le projet ouvert dans l'éditeur, sauf si l'agent en désigne un autre. Il peut aussi créer un projet, vide ou à partir d'un fichier vidéo, en renommer un, et ajouter un fichier vidéo, audio ou image aux médias d'un projet ou en retirer un. Une image est ajoutée comme un clip muet d'elle-même, de quelques secondes. Supprimer un projet ne fait pas partie des outils : cela reste à vous, dans l'application.

## Modifications en direct et annulation {#live-edits-and-undo}

Chaque modification est enregistrée dès qu'elle est appliquée :

- **Sur le projet ouvert dans l'éditeur**, quand OpenScreen est lancé, l'agent passe par l'application. Une modification apparaît aussitôt dans l'éditeur, et chacune est une seule étape de `Ctrl/Cmd + Z`, comme une modification que vous feriez vous-même. Les agents ont pour consigne d'enregistrer un point de restauration avant une série de modifications : vous pouvez donc leur demander de remettre le projet dans son état d'avant en une seule étape, que `Ctrl/Cmd + Z` peut lui-même annuler. Si l'application ne répond pas, les modifications de ce projet sont refusées, car l'éditeur enregistrerait sa propre copie par-dessus.
- **Sur tout autre projet**, une modification est enregistrée dans son fichier, hors de portée de `Ctrl/Cmd + Z`. L'agent doit enregistrer un point de restauration de ce projet avant sa première modification, et y revenir est la seule façon de l'annuler.

Les points de restauration sont gardés en mémoire. Quand OpenScreen est lancé, ils durent jusqu'à ce que vous le quittiez ; sinon, ils durent jusqu'à la fin de la session de l'agent. Seuls les 20 points de restauration les plus récents sont gardés : un plus ancien peut disparaître avant.

## Laisser un agent faire toute la vidéo {#letting-an-agent-make-the-whole-video}

Un agent peut faire une vidéo entière tout seul, de l'enregistrement à l'export. En plus des outils d'édition, `openscreen mcp` lui donne `listSources`, `startRecording`, `stopRecording`, `setPointerTrack`, `exportVideo`, `exportAudio`, `exportCaptions`, `getFrames`, `getContactSheet`, `getBeforeAfter`, `getAudioReport` et `createProject`. Une prise peut aussi enregistrer votre webcam et le curseur du système, comme la barre d'enregistrement, et un export prend les options de la boîte d'export : qualité et fréquence d'images pour un MP4 ; fréquence d'images, taille et boucle pour un GIF. `exportAudio` écrit l'audio du projet, ou une seule piste importée (une voix off ajoutée avec `importMedia` et `addAudio`), dans un WAV ou un M4A, exactement comme le MP4 le mixe. `exportCaptions` écrit les sous-titres dans un fichier SRT ou WebVTT, calé sur la vidéo exportée.

L'agent vérifie aussi son propre travail. `getFrames` montre des moments choisis d'une vidéo, ou un intervalle de `startSec` à `endSec`, et avec une `region` seulement cette partie de l'image, à la résolution propre de la vidéo, pour lire un petit texte. `getContactSheet` dispose de nombreux moments sur une seule image, chacun avec son temps : le rythme du film entier, ou un zoom image par image. `getBeforeAfter` montre les mêmes moments avant et après une série de modifications, côte à côte, et dit où l'image a changé. `getAudioReport` mesure le volume perçu, le pic réel et les silences du son d'un projet. Parmi les outils d'édition, `listStylePresets` et `applyStylePreset` donnent à un projet l'apparence de l'un des **Préréglages** en une seule modification.

- **Chaque prise devient un nouveau projet** dans votre liste de projets, zoomé sur ses clics comme un enregistrement fait dans l'application : des clics rapprochés dans le temps et à l'écran partagent un zoom, et les premières secondes comme la fin restent sur l'écran entier. Chaque modification de l'agent est enregistrée dans le fichier du projet, et elle s'annule avec le point de restauration que prend l'agent : voir [Modifications en direct et annulation](#live-edits-and-undo).
- **Une prise n'a pas de transcription tant que l'agent n'en demande pas.** Il appelle `transcribe` avant de couper des mots ou d'activer les sous-titres. Whisper tourne sur votre machine, dans OpenScreen quand l'application est ouverte.
- **Une prise pilotée par un script** (Playwright, par exemple) ne déplace jamais le pointeur de l'écran. L'agent transmet à OpenScreen son propre journal des actions avec `setPointerTrack`, et la vidéo a malgré tout un curseur et ses zooms.
- **Les skills** enseignent le travail à un agent. `openscreen-demo` le mène du storyboard jusqu'à la vidéo finie, puis joint la vidéo à une pull request, pour que les relecteurs voient le changement sur place, ou rédige un post sur X qu'il ne publie qu'une fois que vous avez dit oui. Six autres vont chacune plus loin dans une étape : `openscreen-capture` (une prise propre et reproductible, y compris une page web enregistrée sans fenêtre), `openscreen-motion` (zooms, annotations et rythme), `openscreen-effects` (effets personnalisés), `openscreen-sound` (narration, musique et volume perçu), `openscreen-review` (la vérification avant que la vidéo ne parte) et `openscreen-deliver` (format, taille, et remise de la vidéo). Ajoutez-les toutes avec `npx skills add getopenscreen/openscreen`. Elles sont dans [`plugin/skills/`](https://github.com/getopenscreen/openscreen/tree/main/plugin/skills).
