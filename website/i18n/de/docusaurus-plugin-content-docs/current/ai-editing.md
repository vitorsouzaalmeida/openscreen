---
id: ai-editing
title: KI-Bearbeitung
sidebar_position: 8
description: "OpenScreen-Projekte mit deinem eigenen Agenten bearbeiten: Claude Code, Codex oder ein beliebiger MCP-Client startet `openscreen mcp` und nimmt auf, bearbeitet, transkribiert und exportiert. Kein Anbieter und kein Schlüssel in der App."
keywords:
  - KI-Videobearbeitung
  - MCP-Videoeditor
  - Videobearbeitung mit Claude Code
  - Videobearbeitung mit Codex
  - Datenschutz
---

# KI-Bearbeitung

OpenScreen hat kein eigenes Modell, und in der App lässt sich auch keines verbinden. Die KI-Bearbeitung übernimmt ein Agent, den du bereits nutzt, etwa Claude Code oder Codex: Er startet `openscreen mcp`, den MCP-Server von OpenScreen, und arbeitet über dessen Werkzeuge. Der Agent meldet sich mit seinem eigenen Konto an, und OpenScreen sieht es nie. OpenScreen selbst sendet nichts an ein Modell: Was der Agent über die Werkzeuge liest, etwa das Projekt, das Transkript und Standbilder, geht an den Anbieter dieses Agenten, unter deinem Konto bei ihm. Die eigene Netzwerknutzung der App (Download der Transkriptionsmodelle, Suche nach Updates) ist in den [FAQ](./faq.md#does-openscreen-work-offline) aufgeführt.

:::tip
Nichts davon ist erforderlich. Aufnahme, Bearbeitung, Transkription, Untertitel und Export funktionieren alle ohne Konto und ohne Agenten. Davon braucht nur die Transkription einen Download, und zwar einmalig: ihre [Modelle](./captions.md#transcribing) beim ersten Durchlauf.
:::

:::note
Frühere Versionen hatten einen Chat-Bereich im Editor, der über deinen eigenen API-Schlüssel mit einem Modellanbieter verbunden war, und einen MCP-Server, der in den Einstellungen der App einzuschalten war. Beide wurden entfernt, zusammen mit den zwei Funktionen, die über diesen Schlüssel liefen: der Schaltfläche **Translate** im Bereich **Captions** und **Smart cuts** im Menü **Auto-enhance** der Zeitleiste. Diese Aufgaben erledigt jetzt dein eigener Agent über die hier beschriebenen Werkzeuge.
:::

## Einrichten {#setting-it-up}

In der App gibt es nichts einzuschalten: kein Port, kein Token, keine Einstellung. Der Agent startet die eigene ausführbare Datei der App mit `mcp` und spricht mit ihr über stdin und stdout, mit deinen Rechten, so wie er `openscreen record` ausführen würde. Deshalb kann er deinen Bildschirm aufnehmen, bearbeiten und exportieren, ohne dass in der App etwas zu erlauben wäre. Am schnellsten fügst du Folgendes in deinen KI-Agenten ein (Claude Code, Codex, Cursor …):

```text
Install the OpenScreen skills with `npx skills add getopenscreen/openscreen -y`, then follow openscreen-demo to make a demo video of this feature.
```

Die Skills installieren OpenScreen, falls es fehlt, sobald du zustimmst. So installiert, ohne das Plugin weiter unten, fügt der Skill `openscreen-demo` den MCP-Server von OpenScreen hinzu und bittet dich danach, eine neue Sitzung zu öffnen und *continue the OpenScreen demo* zu sagen: Ein Agent bekommt neue Werkzeuge nur in einer neuen Sitzung. So richtest du es stattdessen von Hand ein:

```bash
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

`<executable>` ist die ausführbare Datei der App; die jedes Systems steht unter [Die CLI ausführen](./cli.md#running-the-cli). Andere Clients, etwa Cursor, nehmen einen stdio-Server mit der ausführbaren Datei als `command` und `["mcp"]` als `args`.

Die Skills gibt es auch als Plugin, aus dem eigenen Marketplace des Repositorys. In Claude Code:

```text
/plugin marketplace add getopenscreen/openscreen
/plugin install openscreen@openscreen
```

Das Plugin bringt den MCP-Server von OpenScreen mit: Ein kleines Node-Skript findet die installierte App und startet sie mit `mcp`, sodass die Werkzeuge nach `/reload-plugins` oder in einer neuen Sitzung da sind, ohne `claude mcp add`. Findet es keine nutzbare App, bietet es ein einziges Werkzeug an, `openscreenSetup`, das sagt, was es geprüft hat und wie du OpenScreen einrichtest.

Für Codex und die ChatGPT-Desktop-App, die ihre Plugins teilen:

```bash
codex plugin marketplace add getopenscreen/openscreen
codex plugin add openscreen@openscreen
```

OpenScreen erscheint dann mit seinen Skills unter den installierten Plugins der App. Dort wird der MCP-Server mit dem Befehl `codex mcp add` von oben hinzugefügt.

## Was der Agent kann {#what-the-agent-can-do}

Beschreibe die Änderung in Alltagssprache, etwa „schneide die Stille im Intro heraus“ oder „zoome hinein, wenn ich das Terminal öffne“. Der Agent arbeitet mit echten Operationen auf der Zeitleiste, nicht mit einem neuen Rendering: Er kann Schnitte, Zooms, Geschwindigkeitsbereiche, Annotationen (Text, Pfeile und Unschärfen, die private Details auf dem Bildschirm verbergen), importierte Audiospuren samt Ein- und Ausblendung und Full-Camera-Segmente hinzufügen und anpassen, automatische Zooms auf deine Klicks setzen, Start- und Endpunkte und den Zuschnitt eines Clips ändern, Material einer anderen Quelle platzieren, Clips duplizieren, umsortieren oder entfernen und das Transkript lesen, um herauszufinden, was du meinst. Außerdem stellt er das Aussehen des Videos ein: Hintergrund, Innenabstand, abgerundete Ecken, Schatten, Geräterahmen, Format, das Kamera-Layout, den Cursor und die Gesamtlautstärke. Und er kann einen visuellen Effekt schreiben, den die Einstellungen nicht bieten: siehe [Eigene Effekte](./effects.md).

Um zwei Dinge kannst du ihn insbesondere bitten:

- **Stille und Füllwörter herausschneiden.** Der Agent liest das Transkript und schneidet diese Abschnitte heraus, als Schnitte, die du wie deine eigenen ziehen oder löschen kannst. Von Hand schneidest du sie einzeln im [Transkript](./captions.md#transcript-editing).
- **Die Untertitel übersetzen.** Der Editor hat keine Schaltfläche zum Übersetzen. Der Agent liest die Untertitelphrasen, übersetzt sie mit seinem eigenen Modell und speichert das Ergebnis als Sprachebene neben dem Transkript: siehe [Übersetzung](./captions.md#translation). Er kann außerdem die [Untertitel](./captions.md) einschalten, gestalten und platzieren.

`transcribe` lässt Whisper auf deinem Gerät über die Medien eines Projekts laufen, wie der Editor beim Öffnen eines Projekts.

Der Agent kann alle Projekte auflisten und jedes davon lesen oder bearbeiten. Solange OpenScreen geöffnet ist, wirken die Werkzeuge auf das im Editor geöffnete Projekt, es sei denn, der Agent nennt ein anderes. Er kann auch ein Projekt anlegen, leer oder aus einer Videodatei, eines umbenennen und den Medien eines Projekts eine Video-, Audio- oder Bilddatei hinzufügen oder eine daraus entfernen. Ein Bild wird als stummer Clip davon hinzugefügt, einige Sekunden lang. Ein Projekt löschen gehört nicht zu den Werkzeugen: Das bleibt dir in der App vorbehalten.

## Live-Änderungen und Rückgängigmachen {#live-edits-and-undo}

Jede Änderung wird gespeichert, sobald sie ankommt:

- **Am im Editor geöffneten Projekt** arbeitet der Agent über die App, solange OpenScreen läuft. Eine Änderung erscheint sofort im Editor, und jede ist ein einzelner Schritt für `Ctrl/Cmd + Z`, wie eine eigene Änderung von dir. Agenten werden angewiesen, vor einer Reihe von Änderungen einen Wiederherstellungspunkt zu speichern. So kannst du sie bitten, das Projekt in einem einzigen Schritt wiederherzustellen, wie es war, und auch diesen Schritt kann `Ctrl/Cmd + Z` rückgängig machen. Antwortet die App nicht, werden Änderungen an diesem Projekt abgelehnt, denn der Editor würde seine eigene Kopie darüber speichern.
- **An jedem anderen Projekt** wird eine Änderung in seiner Datei gespeichert, wo `Ctrl/Cmd + Z` sie nicht erreicht. Der Agent muss vor der ersten Änderung einen Wiederherstellungspunkt dieses Projekts speichern, und dorthin zurückzukehren ist der einzige Weg, sie rückgängig zu machen.

Wiederherstellungspunkte liegen im Arbeitsspeicher. Läuft OpenScreen, gelten sie, bis es beendet wird; andernfalls gelten sie bis zum Ende der Sitzung des Agenten. Nur die 20 neuesten Wiederherstellungspunkte werden behalten, ein älterer kann also früher verschwinden.

## Einen Agenten das ganze Video erstellen lassen {#letting-an-agent-make-the-whole-video}

Ein Agent kann ein ganzes Video selbstständig erstellen, von der Aufnahme bis zum Export. Neben den Bearbeitungswerkzeugen gibt ihm `openscreen mcp` `listSources`, `startRecording`, `stopRecording`, `setPointerTrack`, `exportVideo`, `exportAudio`, `exportCaptions`, `getFrames`, `getContactSheet`, `getBeforeAfter`, `getAudioReport` und `createProject`. Eine Aufnahme kann wie mit der Aufnahmeleiste auch deine Webcam und den eigenen Mauszeiger des Systems aufnehmen, und ein Export übernimmt die Optionen des Export-Dialogs: Qualität und Bildrate für ein MP4; Bildrate, Größe und Wiederholung für ein GIF. `exportAudio` schreibt den Ton des Projekts, oder eine einzelne importierte Spur (ein mit `importMedia` und `addAudio` hinzugefügtes Voiceover), in eine WAV- oder M4A-Datei, genau so, wie das MP4 ihn mischt. `exportCaptions` schreibt die Untertitel in eine SRT- oder WebVTT-Datei, getaktet auf das exportierte Video.

Der Agent prüft auch seine eigene Arbeit. `getFrames` zeigt gewählte Momente eines Videos oder einen Abschnitt von `startSec` bis `endSec`, und mit einer `region` nur diesen Teil des Bildes, in der eigenen Auflösung des Videos, um kleinen Text zu lesen. `getContactSheet` legt viele Momente auf ein einziges Bild, jeden mit seiner Zeit: den Rhythmus des ganzen Films oder einen Zoom Bild für Bild. `getBeforeAfter` zeigt dieselben Momente vor und nach einer Reihe von Änderungen nebeneinander und sagt, wo sich das Bild geändert hat. `getAudioReport` misst Lautheit, True Peak und Stille im Ton eines Projekts. Unter den Bearbeitungswerkzeugen geben `listStylePresets` und `applyStylePreset` einem Projekt in einer einzigen Änderung den Look einer der **Vorgaben**.

- **Jeder Take wird zu einem neuen Projekt** in deiner Projektliste, mit Zooms auf seine Klicks, wie eine in der App gemachte Aufnahme: Zeitlich und räumlich nah beieinanderliegende Klicks teilen sich einen Zoom, und die ersten Sekunden und das Ende bleiben auf dem ganzen Bildschirm. Jede Änderung des Agenten wird in der Projektdatei gespeichert, und rückgängig macht sie der Wiederherstellungspunkt, den der Agent anlegt: siehe [Live-Änderungen und Rückgängigmachen](#live-edits-and-undo).
- **Ein Take hat kein Transkript, bis der Agent eines anfordert.** Er ruft `transcribe` auf, bevor er Wörter schneidet oder die Untertitel einschaltet. Whisper läuft auf deinem Rechner, in OpenScreen, wenn die App geöffnet ist.
- **Ein per Skript gesteuerter Take** (zum Beispiel mit Playwright) bewegt nie den Zeiger auf dem Bildschirm. Der Agent übergibt OpenScreen mit `setPointerTrack` sein eigenes Protokoll der Aktionen, und das Video bekommt trotzdem einen Cursor und dessen Zooms.
- **Die Skills** bringen einem Agenten die Arbeit bei. `openscreen-demo` führt sie vom Storyboard bis zum fertigen Video, hängt das Video danach an einen Pull Request, damit die Reviewer die Änderung direkt dort sehen, oder entwirft einen Post auf X, den er erst veröffentlicht, wenn du Ja sagst. Sechs weitere gehen jeweils tiefer in einen Schritt: `openscreen-capture` (ein sauberer, wiederholbarer Take, auch eine Webseite, die ohne Fenster aufgenommen wird), `openscreen-motion` (Zooms, Einblendungen und Tempo), `openscreen-effects` (eigene Effekte), `openscreen-sound` (Sprecher, Musik und Lautheit), `openscreen-review` (die Prüfung, bevor das Video rausgeht) und `openscreen-deliver` (Format, Größe und die Übergabe des Videos). Füge sie alle mit `npx skills add getopenscreen/openscreen` hinzu. Sie liegen in [`plugin/skills/`](https://github.com/getopenscreen/openscreen/tree/main/plugin/skills).
