# ComfyUI_Pose-Gallery · diretório de acervo personalizado

A biblioteca personalizada e a interna são independentes. Com a personalizada selecionada, as imagens são procuradas somente na lista dela.

```text
minha-biblioteca-de-poses/
├── data/pose-pt.json
├── img/
│   ├── my_pose_001_front.png
│   └── my_pose_001_side.png
└── thumbs/                         # opcional; sem a miniatura, cai no original
    ├── my_pose_001_front.jpg
    └── my_pose_001_side.jpg
```

`data/pose-pt.json` usa UTF-8 e contém uma lista não vazia:

```json
[
  {
    "id": "my_pose_001_front",
    "serie": "Minhas poses",
    "numero": "P001",
    "categoria": "Em pé",
    "nome": "Em pé com o braço erguido",
    "angulo": "Frente",
    "original": "img/my_pose_001_front.png",
    "miniatura": "thumbs/my_pose_001_front.jpg"
  },
  {
    "id": "my_pose_001_side",
    "serie": "Minhas poses",
    "numero": "P001",
    "categoria": "Em pé",
    "nome": "Em pé com o braço erguido",
    "angulo": "Perfil",
    "original": "img/my_pose_001_side.png",
    "miniatura": "thumbs/my_pose_001_side.jpg"
  }
]
```

- O ID é único em toda a biblioteca; prefira IDs estáveis, fáceis de compartilhar.
- `serie` e `numero` juntos definem o agrupamento; o mesmo número pode aparecer em séries diferentes.
- Todos os campos acima são texto não vazio; `miniatura` pode ser omitido.
- Use Frente, Diagonal, Perfil, De cima e De baixo, com uma imagem por ângulo da mesma pose. Outros ângulos continuam aparecendo na navegação imagem por imagem e na saída.
- Os caminhos das imagens são relativos à raiz da biblioteca, separados por `/`; caminhos absolutos ou que saiam do diretório não são aceitos.
- São aceitos PNG, JPG/JPEG, WebP e BMP. A miniatura deve manter a proporção do original; o tamanho do original é livre.
- Não é preciso preencher `busca`: o plugin gera o texto de pesquisa a partir dos outros campos, sem acentos.

Em «Configurar acervo», informe o caminho absoluto de `minha-biblioteca-de-poses`, salve com a verificação e troque para o diretório personalizado.

Ao adicionar ou remover imagens, mantenha a lista em dia e recarregue a galeria ou o navegador. O cache de execução acompanha a data de modificação e o tamanho da lista e das imagens escolhidas. IDs estáveis deixam o fluxo funcionar em computadores diferentes; ao trocar de máquina, basta configurar o diretório de novo.

Nesta primeira versão há um diretório personalizado por instância do ComfyUI; é uma configuração do servidor, então todos os navegadores ligados à mesma instância usam o mesmo diretório.
