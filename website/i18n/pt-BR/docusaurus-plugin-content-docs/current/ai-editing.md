---
id: ai-editing
title: Edição com IA
sidebar_position: 8
description: "Edite projetos do OpenScreen com o seu próprio agente: o Claude Code, o Codex ou qualquer cliente MCP inicia `openscreen mcp` e grava, edita, transcreve e exporta. Sem provedor e sem chave no app."
keywords:
  - edição de vídeo com IA
  - editor de vídeo com MCP
  - edição de vídeo com Claude Code
  - edição de vídeo com Codex
  - privacidade
---

# Edição com IA

O OpenScreen não tem modelo próprio, e não há nenhum para conectar no app. A edição com IA é feita por um agente que você já usa, como o Claude Code ou o Codex: ele inicia `openscreen mcp`, o servidor MCP do OpenScreen, e trabalha por meio das ferramentas dele. O agente se conecta com a própria conta, e o OpenScreen nunca a vê. O OpenScreen em si não envia nada a nenhum modelo: o que o agente lê pelas ferramentas, como o projeto, a transcrição e quadros estáticos, vai para o provedor desse agente, na conta que você tem com ele. Os usos de rede do próprio app (o download dos modelos de transcrição, a verificação de atualizações) estão listados nas [perguntas frequentes](./faq.md#does-openscreen-work-offline).

:::tip
Nada disso é obrigatório. Gravação, edição, transcrição, legendas e exportação funcionam sem conta e sem agente. Dessas, só a transcrição precisa de um download, uma única vez: os [modelos](./captions.md#transcribing) dela, na primeira execução.
:::

:::note
Versões anteriores tinham um painel de chat no editor, conectado a um provedor de modelos com a sua própria chave de API, e um servidor MCP para ativar nas configurações do app. Os dois foram removidos, junto com os dois recursos que rodavam com essa chave: o botão **Traduzir** no painel de legendas e os **Cortes inteligentes** no menu **Melhoria automática** da linha do tempo. Agora é o seu próprio agente que faz esses trabalhos, pelas ferramentas descritas aqui.
:::

## Como configurar {#setting-it-up}

Não há nada para ativar no app: sem porta, sem token, sem configuração. O agente inicia o próprio executável do app com `mcp` e conversa com ele por stdin e stdout, com as suas permissões, como faria ao rodar `openscreen record`. Por isso ele pode gravar a sua tela, editar e exportar sem que nada precise ser autorizado no app. O jeito mais rápido é colar isto no seu agente de IA (Claude Code, Codex, Cursor…):

```text
Install the OpenScreen skills with `npx skills add getopenscreen/openscreen -y`, then follow openscreen-demo to make a demo video of this feature.
```

As skills instalam o OpenScreen se ele estiver faltando, depois que você concordar. Instalada desse jeito, sem o plugin abaixo, a skill `openscreen-demo` adiciona o servidor MCP do OpenScreen e, em seguida, pede que você abra uma nova sessão e diga *continue the OpenScreen demo*: um agente só recebe ferramentas novas em uma nova sessão. Para configurar à mão, em vez disso:

```bash
claude mcp add openscreen -- "<executable>" mcp
codex mcp add openscreen -- "<executable>" mcp
```

`<executable>` é o executável do app; o de cada sistema está listado em [Como executar a CLI](./cli.md#running-the-cli). Outros clientes, como o Cursor, usam um servidor stdio com o executável como `command` e `["mcp"]` como `args`.

As skills também vêm como plugin, a partir do marketplace do próprio repositório. No Claude Code:

```text
/plugin marketplace add getopenscreen/openscreen
/plugin install openscreen@openscreen
```

O plugin traz consigo o servidor MCP do OpenScreen: um pequeno script Node encontra o app instalado e o inicia com `mcp`, então as ferramentas estão lá depois de `/reload-plugins` ou em uma nova sessão, sem `claude mcp add`. Quando não encontra nenhum app utilizável, ele oferece uma única ferramenta, `openscreenSetup`, que diz o que verificou e como configurar o OpenScreen.

Para o Codex e o app para desktop do ChatGPT, que compartilham os plugins:

```bash
codex plugin marketplace add getopenscreen/openscreen
codex plugin add openscreen@openscreen
```

O OpenScreen então aparece entre os plugins instalados do app, com as suas skills. Ali, o servidor MCP é adicionado com o comando `codex mcp add` acima.

## O que o agente pode fazer {#what-the-agent-can-do}

Descreva a edição em linguagem natural — "corte o tempo morto da introdução", "dê zoom quando eu abrir o terminal". O agente trabalha com operações reais da linha do tempo, e não com uma nova renderização: ele pode adicionar e ajustar recortes, zooms, regiões de velocidade, anotações (texto, setas e desfoques que escondem dados privados na tela), faixas de áudio importadas com seus fades e segmentos de Câmera em Tela Cheia, adicionar zooms automáticos nos seus cliques, editar os pontos de entrada/saída e o corte de um clipe, posicionar as imagens de outra fonte, duplicar, reordenar ou remover clipes e ler a transcrição para encontrar o trecho a que você se refere. Ele também ajusta a aparência do vídeo: fundo, margem, cantos arredondados, sombra, moldura de dispositivo, formato, o layout da câmera, o cursor e o volume geral. E ele pode escrever um efeito visual que as configurações não oferecem: veja [Efeitos personalizados](./effects.md).

Duas coisas para pedir a ele em especial:

- **Cortar silêncios e palavras de preenchimento.** O agente lê a transcrição e corta esses trechos como recortes, que você pode arrastar ou excluir como os seus. À mão, você os corta um por vez na [transcrição](./captions.md#transcript-editing).
- **Traduzir as legendas.** O editor não tem botão de tradução. O agente lê as frases das legendas, traduz com o próprio modelo e armazena o resultado como uma camada de idioma ao lado da transcrição: veja [Tradução](./captions.md#translation). Ele também pode ativar as [legendas](./captions.md), estilizá-las e posicioná-las.

`transcribe` roda o Whisper no seu computador sobre a mídia de um projeto, como o editor faz ao abrir um projeto.

O agente pode listar todos os projetos e ler ou editar qualquer um deles. Enquanto o OpenScreen está aberto, as ferramentas agem sobre o projeto aberto no editor, a menos que o agente indique outro. Ele também pode criar um projeto, vazio ou a partir de um arquivo de vídeo, renomear um, e adicionar um arquivo de vídeo, de áudio ou de imagem às mídias de um projeto ou remover um. Uma imagem é adicionada como um clipe mudo dela, de alguns segundos. Excluir um projeto não está entre as ferramentas: isso fica com você, no aplicativo.

## Edições ao vivo e como desfazer {#live-edits-and-undo}

Cada edição é salva assim que é aplicada:

- **No projeto aberto no editor**, enquanto o OpenScreen está em execução, o agente trabalha por meio do app. Uma edição aparece no editor na hora, e cada uma é um único passo de `Ctrl/Cmd + Z`, como uma edição sua. Os agentes são instruídos a salvar um ponto de restauração antes de uma série de edições, então você pode pedir a eles que deixem o projeto como estava em um único passo, que o próprio `Ctrl/Cmd + Z` pode desfazer. Se o app não responder, as edições desse projeto são recusadas, porque o editor salvaria a própria cópia por cima.
- **Em qualquer outro projeto**, uma edição é salva no arquivo dele, fora do alcance de `Ctrl/Cmd + Z`. O agente precisa salvar um ponto de restauração desse projeto antes da primeira edição, e voltar a ele é a única forma de desfazê-la.

Os pontos de restauração ficam na memória. Enquanto o OpenScreen está em execução, eles duram até ele ser fechado; caso contrário, duram até o fim da sessão do agente. Só os 20 pontos de restauração mais recentes são mantidos, então um mais antigo pode sumir antes.

## Como deixar um agente fazer o vídeo inteiro {#letting-an-agent-make-the-whole-video}

Um agente pode fazer um vídeo inteiro sozinho, da gravação à exportação. Além das ferramentas de edição, `openscreen mcp` lhe dá `listSources`, `startRecording`, `stopRecording`, `setPointerTrack`, `exportVideo`, `exportAudio`, `exportCaptions`, `getFrames`, `getContactSheet`, `getBeforeAfter`, `getAudioReport` e `createProject`. Uma gravação também pode incluir sua webcam e o cursor do próprio sistema, como a barra de gravação, e uma exportação aceita as opções da caixa de exportação: qualidade e taxa de quadros para um MP4; taxa de quadros, tamanho e repetição para um GIF. `exportAudio` grava o áudio do projeto, ou uma única faixa importada (uma narração adicionada com `importMedia` e `addAudio`), em um WAV ou um M4A, exatamente como o MP4 o mixa. `exportCaptions` grava as legendas em um arquivo SRT ou WebVTT, sincronizado com o vídeo exportado.

O agente também confere o próprio trabalho. `getFrames` mostra momentos escolhidos de um vídeo, ou um trecho de `startSec` a `endSec`, e com uma `region` só essa parte da imagem, na resolução do próprio vídeo, para ler texto pequeno. `getContactSheet` reúne vários momentos em uma única imagem, cada um com o seu tempo: o ritmo do vídeo inteiro, ou um zoom quadro a quadro. `getBeforeAfter` mostra os mesmos momentos antes e depois de uma série de edições, lado a lado, e diz onde a imagem mudou. `getAudioReport` mede o volume percebido, o pico real e os silêncios do som de um projeto. Entre as ferramentas de edição, `listStylePresets` e `applyStylePreset` dão a um projeto o visual de uma das **Predefinições** em uma única edição.

- **Cada tomada vira um novo projeto** na sua lista de projetos, com zooms nos seus cliques, como uma gravação feita no app: cliques próximos no tempo e na tela dividem um zoom, e os primeiros segundos e o final ficam na tela inteira. Cada edição do agente é salva no arquivo do projeto, e ela se desfaz com o ponto de restauração que o agente cria: veja [Edições ao vivo e como desfazer](#live-edits-and-undo).
- **Uma tomada não tem transcrição até o agente pedir uma.** Ele chama `transcribe` antes de cortar palavras ou ativar as legendas. O Whisper roda no seu computador, dentro do OpenScreen quando ele está aberto.
- **Uma tomada conduzida por um script** (o Playwright, por exemplo) nunca move o ponteiro da tela. O agente passa ao OpenScreen o próprio registro das ações com `setPointerTrack`, e o vídeo ganha um cursor e seus zooms do mesmo jeito.
- **As skills** ensinam o trabalho a um agente. A `openscreen-demo` o conduz do storyboard até o vídeo pronto e depois anexa o vídeo a um pull request, para que os revisores vejam a mudança ali mesmo, ou redige um post no X que só publica depois que você disser sim. Outras seis vão mais fundo, cada uma, em uma etapa: `openscreen-capture` (uma tomada limpa e repetível, inclusive de uma página web gravada sem nenhuma janela), `openscreen-motion` (zooms, anotações e ritmo), `openscreen-effects` (efeitos personalizados), `openscreen-sound` (narração, música e volume percebido), `openscreen-review` (a verificação antes de o vídeo sair) e `openscreen-deliver` (formato, tamanho e entrega do vídeo). Adicione todas com `npx skills add getopenscreen/openscreen`. Elas ficam em [`plugin/skills/`](https://github.com/getopenscreen/openscreen/tree/main/plugin/skills).
