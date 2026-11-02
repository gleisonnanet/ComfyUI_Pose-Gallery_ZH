# ComfyUI_Pose-Gallery · fluxos de exemplo

Arraste o JSON para dentro do ComfyUI.

1. `01_single_image.json`: imagem do acervo incluído → prévia, sem modelos extras.
2. `02_batch_all_angles.json`: todos os ângulos disponíveis da pose atual → prévia em lote, ajustado com borda em 768×1024.
3. `03_dwpose_preview.json`: galeria → DWPose → prévia do esqueleto. Precisa do `comfyui_controlnet_aux` e dos modelos de pré-processamento.
4. `04_controlnet_template.json`: ligação completa de controle de pose em SD1.5. Troque os nomes de modelo que são apenas marcadores nos carregadores e escolha o seu modelo base SD1.5 e um OpenPose ControlNet correspondente. A imagem é 512×768 e pode ser ajustada.

Os dois primeiros exemplos já rodaram em um ComfyUI real. Nos dois últimos as interfaces e ligações dos nós foram conferidas, sem executar inferência nem amostragem.
