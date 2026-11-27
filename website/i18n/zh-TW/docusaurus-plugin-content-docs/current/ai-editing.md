---
id: ai-editing
title: AI 剪輯
sidebar_position: 8
description: "用你自己的代理剪輯 OpenScreen 專案：Claude Code、Codex 或任何 MCP 用戶端會啟動 `openscreen mcp`，進行錄影、剪輯、轉錄與匯出。應用程式中沒有提供者，也沒有金鑰。"
keywords:
  - AI 影片剪輯
  - MCP 影片編輯器
  - Claude Code 影片剪輯
  - Codex 影片剪輯
  - 隱私
---

# AI 剪輯

OpenScreen 沒有自己的模型，應用程式中也沒有模型可以連接。AI 剪輯由你已經在使用的代理完成，例如 Claude Code 或 Codex：它會啟動 `openscreen mcp`，也就是 OpenScreen 的 MCP 伺服器，並透過其中的工具工作。代理以自己的帳號登入，OpenScreen 永遠看不到這個帳號。OpenScreen 本身不會把任何內容送往任何模型：代理透過工具讀取的內容，例如專案、逐字稿與靜態影格，會以你在該代理的帳號送往該代理的提供者。應用程式本身的網路使用（轉錄模型下載、更新檢查）列在[常見問題](./faq.md#does-openscreen-work-offline)中。

:::tip
這些都不是必要的。錄影、剪輯、轉錄、字幕與匯出，全都不需要帳號也不需要代理就能使用。其中只有轉錄需要下載一次：第一次執行時下載[轉錄模型](./captions.md#transcribing)。
:::

:::note
較早的版本在編輯器中有一個聊天面板，以你自己的 API 金鑰連接模型提供者；應用程式的設定中還有一個可以開啟的 MCP 伺服器。兩者都已移除，一併移除的還有依賴該金鑰運作的兩項功能：字幕窗格中的**翻譯**按鈕，以及時間軸**自動加強**選單中的**智慧剪輯**。現在這些工作由你自己的代理透過本頁說明的工具完成。
:::

## 設定 {#setting-it-up}

應用程式中沒有任何東西需要開啟：不需要連接埠、權杖或設定。代理會以 `mcp` 啟動應用程式本身的執行檔，並透過 stdin 與 stdout 與它通訊；它以你的權限執行，就像它執行 `openscreen record` 一樣。因此，它不需要在應用程式中取得任何許可，就能錄製你的螢幕、進行剪輯與匯出。最快的方式是將下面這段內容貼到你的AI 代理（Claude Code、Codex、Cursor 等）中：

```text
Install the OpenScreen skills with `npx skills add getopenscreen/openscreen -y`, then follow openscreen-demo to make a demo video of this feature.
```

如果缺少 OpenScreen，這些技能會在你同意後安裝它。以這種方式安裝、且不使用下方的外掛時，`openscreen-demo` 技能會加入 OpenScreen 的 MCP 伺服器，接著請你開啟一個新的工作階段，並說出 *continue the OpenScreen demo*：代理只有在新的工作階段中才能取得新工具。若要改為手動設定：

```bash
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

`<executable>` 是應用程式的執行檔，各系統上的路徑列在[執行 CLI](./cli.md#running-the-cli)中。其他用戶端（例如 Cursor）以 stdio 伺服器的方式加入：執行檔作為 `command`，`["mcp"]` 作為 `args`。

這些技能也以外掛形式提供，來自儲存庫本身的外掛市集。在 Claude Code 中：

```text
/plugin marketplace add getopenscreen/openscreen
/plugin install openscreen@openscreen
```

外掛本身帶有 OpenScreen 的 MCP 伺服器：一個小型 Node 腳本會找到已安裝的應用程式，並以 `mcp` 啟動它，因此執行 `/reload-plugins` 後或在新的工作階段中，工具就已可用，不需要 `claude mcp add`。如果找不到可用的應用程式，它只提供一個工具 `openscreenSetup`，說明它檢查了什麼，以及如何安裝與設定 OpenScreen。

對於共用外掛的 Codex 與 ChatGPT 桌面應用程式：

```bash
codex plugin marketplace add getopenscreen/openscreen
codex plugin add openscreen@openscreen
```

之後，OpenScreen 會連同其技能一起出現在應用程式的已安裝外掛中。在這裡，MCP 伺服器要用上方的 `codex mcp add` 指令加入。

## 代理能做什麼 {#what-the-agent-can-do}

用一般的語言描述你要的剪輯，例如「剪掉開頭的空檔」、「我打開終端機時放大畫面」。代理會透過真實的時間軸操作來完成工作，而不是重新算繪：它可以新增與調整剪輯、縮放、速度區域、標註（文字、箭頭，以及遮住畫面上隱私資訊的模糊）、匯入的音軌及其淡入淡出與全螢幕攝影機片段，在你的點擊處加入自動縮放，編輯片段的入點與出點和裁切，放入另一個來源的畫面，複製、重新排序或移除片段，也會讀取逐字稿來找出你指的是哪一段。它也能設定影片的外觀：背景、邊距、圓角、陰影、裝置外框、畫面比例、攝影機版面、游標與整體音量。它還能寫出設定裡沒有的視覺效果：請參閱[自訂效果](./effects.md)。

有兩件事特別值得交給它：

- **剪掉靜音與贅詞。** 代理會讀取逐字稿，並把這些範圍以剪輯區域剪除；你可以像處理自己的剪輯區域一樣拖曳或刪除它們。若要手動進行，則是在[逐字稿](./captions.md#transcript-editing)中一次剪除一段。
- **翻譯字幕。** 編輯器沒有翻譯按鈕。代理會讀取字幕語句，用自己的模型翻譯，並把結果存成逐字稿旁邊的一個語言層：請參閱[翻譯](./captions.md#translation)。它也能開啟[字幕](./captions.md)，並設定字幕的樣式與位置。

`transcribe` 會像編輯器開啟專案時那樣，在你的裝置上用 Whisper 處理專案的媒體。

代理可以列出所有專案，並讀取或編輯其中任何一個。OpenScreen 開啟時，除非代理指定其他專案，否則這些工具作用於編輯器中開啟的專案。它也可以建立專案（空白專案，或從一個影片檔建立）、重新命名專案，以及在專案的媒體中加入或移除影片、音訊或圖片檔。圖片會作為顯示該圖片的幾秒無聲片段加入。刪除專案不在這些工具之中：這仍由你在應用程式中進行。

## 即時編輯與復原 {#live-edits-and-undo}

每項編輯都會在生效時立即儲存：

- **在編輯器中開啟的專案上**，只要 OpenScreen 正在執行，代理就會透過應用程式進行編輯。編輯會立即顯示在編輯器中，而且每一項都是一個 `Ctrl/Cmd + Z` 步驟，和你自己的編輯一樣。代理會被告知在進行一系列編輯之前先儲存檢查點，因此你可以請它們一步將專案還原成原本的樣子，而這一步本身也可以用 `Ctrl/Cmd + Z` 復原。如果應用程式沒有回應，對該專案的編輯會被拒絕，因為編輯器會用自己的副本覆寫這些編輯。
- **在其他任何專案上**，編輯會儲存到它的檔案中，`Ctrl/Cmd + Z` 無法復原。代理必須在第一次編輯之前儲存該專案的檢查點，還原到這個檢查點是唯一的復原方式。

檢查點保存在記憶體中。OpenScreen 執行時，檢查點會保留到它結束為止；否則會保留到代理的工作階段結束為止。只會保留最近的 20 個檢查點，因此較早的檢查點可能會提早失效。

## 讓代理製作整支影片 {#letting-an-agent-make-the-whole-video}

代理可以從錄影到匯出自行製作一整支影片。除了剪輯工具之外，`openscreen mcp` 還讓代理能使用 `listSources`、`startRecording`、`stopRecording`、`setPointerTrack`、`exportVideo`、`exportAudio`、`exportCaptions`、`getFrames`、`getContactSheet`、`getBeforeAfter`、`getAudioReport` 與 `createProject`。與錄影列一樣，錄影時也能錄下你的網路攝影機與系統本身的游標；匯出則接受匯出對話框的選項：MP4 的畫質與影格速率，GIF 的影格速率、尺寸與循環播放。`exportAudio` 將專案的音訊，或單獨一條匯入的音軌（以 `importMedia` 與 `addAudio` 加入的旁白），寫入 WAV 或 M4A，與 MP4 的混音完全相同。`exportCaptions` 將字幕寫入 SRT 或 WebVTT 字幕檔，時間與匯出的影片對齊。

代理也能檢查自己的成果。`getFrames` 顯示影片中選定的時刻，或從 `startSec` 到 `endSec` 的一段；加上 `region` 時，只傳回畫面的這一部分，並維持影片本身的解析度，方便看清小字。`getContactSheet` 把許多時刻排在一張圖上，每個都標有時間：可以看整支影片的節奏，也可以逐格看一次縮放。`getBeforeAfter` 把一連串編輯前後的同一時刻並排顯示，並指出畫面在哪裡有了變化。`getAudioReport` 測量專案聲音的響度、真峰值與靜音段。在剪輯工具中，`listStylePresets` 與 `applyStylePreset` 透過一次編輯，讓專案套用某個**預設**的外觀。

- **每段錄影都會成為一個新專案**，出現在你的專案清單中，並和在應用程式中錄製的影片一樣，在錄下的點擊處加上縮放：時間與位置都相近的點擊共用一個縮放，開頭幾秒與結尾保持全螢幕。代理的每項編輯都會儲存到專案檔案中，要復原就靠代理建立的檢查點：請參閱[即時編輯與復原](#live-edits-and-undo)。
- **在代理要求之前，錄影沒有逐字稿。** 代理會在刪除字詞或開啟字幕之前呼叫 `transcribe`。Whisper 在你的電腦上執行，OpenScreen 開啟時則在 OpenScreen 中執行。
- **由腳本驅動的錄影**（例如 Playwright）永遠不會移動螢幕上的指標。代理會用 `setPointerTrack` 把它自己的操作記錄交給 OpenScreen，影片照樣會有游標與其縮放。
- **這些技能**教代理如何完成工作。`openscreen-demo` 帶它從分鏡腳本做到完成的影片，之後把影片附加到拉取請求中，讓審閱者直接在那裡看到變更；或者草擬一則 X 貼文，而且只有在你同意之後才會發布。另外六個技能各自深入一個步驟：`openscreen-capture`（乾淨、可重複的錄影，包括不開啟任何視窗錄下的網頁）、`openscreen-motion`（縮放、標註與節奏）、`openscreen-effects`（自訂效果）、`openscreen-sound`（旁白、音樂與響度）、`openscreen-review`（影片送出前的檢查）與 `openscreen-deliver`（格式、大小以及交付影片）。使用 `npx skills add getopenscreen/openscreen` 一次全部加入。它們位於 [`plugin/skills/`](https://github.com/getopenscreen/openscreen/tree/main/plugin/skills)。
