# ComfyUI_Pose-Gallery · registro de verificação e como reproduzir

28/10/2026, instância local dedicada com ComfyUI 0.43.0, frontend 1.57.6, Python 3.12, PyTorch 2.10.0, Edge / Playwright 1.62.1.

Já feito:

- Plugin carregado de um diretório próprio e testado no navegador, com o acervo independente do projeto original.
- 15 verificações de back-end: agrupamento, ângulo ausente, existência dos arquivos, faixa e tamanho do tensor IMAGE, ordem do lote, espelhamento e borda, salvamento da configuração, diretório inválido, mudança de arquivo, interface HTTP e caminhos fora da biblioteca.
- 5 verificações de lógica no front-end: busca combinada, busca sem acentos, agrupamento, ordem dos ângulos, favoritas e recentes, e degradação quando o armazenamento do navegador não está disponível.
- Existência, tamanho e cabeçalho PNG/JPG de 2.878 arquivos, sem problemas.
- Teste no navegador real: barra lateral e seletor expandido, layout em duas colunas, atualização de um nó indicado, preservação de conexões e tamanhos, recusa de várias imagens no nó de imagem única, envio em lote, ângulo ausente desabilitado, salvar e reabrir o fluxo, troca de diretório personalizado.
- Execução real na fila, com saída de 1 imagem 128×160 e 5 imagens 64×80, conferindo o tamanho nos PNG de saída.
- Os exemplos de imagem única e de todos os ângulos rodaram em um ComfyUI real, com saída de 1 e de 5 imagens.

Nos exemplos de DWPose e ControlNet as ligações foram conferidas nas interfaces dos nós das extensões instaladas, sem executar inferência de esqueleto nem amostragem. Outras versões de software ainda precisam de verificação real.

## Verificações automáticas

Com o Python do ComfyUI:

```bash
python -m unittest discover -s tests -v
python -X utf8 scripts/verify.py
```

Com Node.js 22 ou mais novo:

```bash
node --test tests/frontend.test.mjs
```

## Teste no navegador

O teste limpa o fluxo atual, executa prévias de imagem e configura e limpa temporariamente o diretório personalizado. Use uma instância e um diretório de usuário dedicados a testes.

```bash
npm install
npx playwright install chromium
```

Suba um ComfyUI isolado com apenas este plugin, por exemplo na porta 8197, e rode:

```powershell
# Windows PowerShell
$env:POSE_GALLERY_TEST_URL = "http://127.0.0.1:8197"
npm run test:browser
```

```bash
# Linux / macOS
POSE_GALLERY_TEST_URL=http://127.0.0.1:8197 npm run test:browser
```

Opcionalmente use `POSE_GALLERY_BROWSER_CHANNEL=msedge` para aproveitar o Edge instalado. Os artefatos do teste vão para `.test-output/`, que não é versionado, e a captura de tela atualiza `docs/plugin-preview.png`.
