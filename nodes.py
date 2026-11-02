"""Standard ComfyUI image nodes. No inference models or downloads required."""

from __future__ import annotations

import json

import numpy as np
import torch
from PIL import Image, ImageOps

from .gallery import (DEFAULT_ID, MAX_BATCH_PIXELS, SOURCES, GalleryError, batch_items,
                      catalogue, source_key)

RESIZE_MODES = ["Tamanho original", "Ajustar com borda", "Recorte central", "Esticar"]


def image_inputs(batch=False):
    return {
        "asset_source": (list(SOURCES), {"default": SOURCES[0], "tooltip": "Usa o acervo incluído no plugin. O diretório personalizado é configurado em «Acervo», na galeria."}),
        "resize_mode": (RESIZE_MODES, {"default": "Ajustar com borda" if batch else "Tamanho original"}),
        "width": ("INT", {"default": 768, "min": 64, "max": 4096, "step": 8}),
        "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
        "flip_horizontal": ("BOOLEAN", {"default": False, "label_on": "espelhar", "label_off": "não espelhar"}),
    }


def load_image(cat, item, resize_mode, width, height, flip_horizontal):
    if resize_mode not in RESIZE_MODES:
        raise GalleryError("Modo de redimensionamento desconhecido.")
    if not 64 <= width <= 4096 or not 64 <= height <= 4096:
        raise GalleryError("A largura e a altura de saída devem ficar entre 64 e 4096.")
    path = cat.path(item)
    try:
        with Image.open(path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            image = background.convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise GalleryError(f"Imagem ilegível ou corrompida: {path.name}") from exc
    if flip_horizontal:
        image = ImageOps.mirror(image)
    size = (int(width), int(height))
    if resize_mode == "Ajustar com borda":
        image = ImageOps.pad(image, size, method=Image.Resampling.LANCZOS, color="white")
    elif resize_mode == "Recorte central":
        image = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
    elif resize_mode == "Esticar":
        image = image.resize(size, Image.Resampling.LANCZOS)
    return torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0)


def describe(item):
    return f"{item['nome']} | {item['serie']} | {item['categoria']} | {item['angulo']} | {item['id']}"


class PoseGalleryImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "pose_id": ("STRING", {"default": DEFAULT_ID, "tooltip": "Clique em «Abrir galeria de poses» para escolher; não é preciso digitar."}),
            **image_inputs(),
        }}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("imagem", "ID da imagem", "descrição da pose")
    FUNCTION = "execute"
    CATEGORY = "Galeria de poses"
    DESCRIPTION = "Lê uma imagem de referência do acervo interno ou personalizado. Para controlar a pose, ligue um pré-processador DWPose/OpenPose e o ControlNet correspondente."

    def execute(self, pose_id=DEFAULT_ID, asset_source=SOURCES[0], resize_mode="Tamanho original",
                width=768, height=1024, flip_horizontal=False):
        cat = catalogue(asset_source)
        item = cat.item(pose_id)
        image = load_image(cat, item, resize_mode, width, height, flip_horizontal)
        return image.unsqueeze(0), item["id"], describe(item)

    @classmethod
    def IS_CHANGED(cls, pose_id=DEFAULT_ID, asset_source=SOURCES[0], **kwargs):
        cat = catalogue(asset_source)
        return cat.fingerprint([cat.item(pose_id)])


class PoseGalleryBatch:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "pose_ids": ("STRING", {"multiline": True, "default": DEFAULT_ID, "tooltip": "Um ID por linha. Marque as imagens na galeria e envie para este nó; no máximo 32."}),
            "selection_mode": (["Seleção manual", "Todos os ângulos da pose"],),
            "pose_id": ("STRING", {"default": DEFAULT_ID, "tooltip": "No modo de todos os ângulos, vale a pose à qual este ID pertence."}),
            "order": (["Ordem de seleção", "Ordem por ângulo", "Ordem por ID"],),
            **image_inputs(batch=True),
        }}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("lote de imagens", "JSON da lista")
    FUNCTION = "execute"
    CATEGORY = "Galeria de poses"
    DESCRIPTION = "Lê várias imagens de referência independentes. Por padrão ajusta com borda para igualar o tamanho; a lista segue a ordem do lote. No máximo 32 imagens e 32 milhões de pixels no total."

    def execute(self, pose_ids=DEFAULT_ID, selection_mode="Seleção manual", pose_id=DEFAULT_ID,
                order="Ordem de seleção", asset_source=SOURCES[0], resize_mode="Ajustar com borda",
                width=768, height=1024, flip_horizontal=False):
        cat = catalogue(asset_source)
        items = batch_items(cat, pose_ids, selection_mode, pose_id, order)
        if resize_mode != "Tamanho original" and len(items) * width * height > MAX_BATCH_PIXELS:
            raise GalleryError("O lote passa de 32 milhões de pixels. Reduza a quantidade de imagens ou o tamanho de saída.")
        images, records = [], []
        shape = None
        total_pixels = 0
        for index, item in enumerate(items):
            image = load_image(cat, item, resize_mode, width, height, flip_horizontal)
            if shape is not None and tuple(image.shape) != shape:
                raise GalleryError("As imagens originais têm tamanhos diferentes. Use ajustar com borda, recorte central ou esticar para igualá-las.")
            shape = tuple(image.shape)
            total_pixels += shape[0] * shape[1]
            if total_pixels > MAX_BATCH_PIXELS:
                raise GalleryError("O lote passa de 32 milhões de pixels. Reduza a quantidade de imagens ou o tamanho de saída.")
            images.append(image)
            records.append({"index": index, "id": item["id"], "serie": item["serie"],
                            "numero": item["numero"], "nome": item["nome"],
                            "categoria": item["categoria"], "angulo": item["angulo"],
                            "asset_source": source_key(asset_source),
                            "width": shape[1], "height": shape[0],
                            "resize_mode": resize_mode, "flip_horizontal": flip_horizontal})
        return torch.stack(images), json.dumps(records, ensure_ascii=False, indent=2)

    @classmethod
    def IS_CHANGED(cls, pose_ids=DEFAULT_ID, selection_mode="Seleção manual", pose_id=DEFAULT_ID,
                   order="Ordem de seleção", asset_source=SOURCES[0], **kwargs):
        cat = catalogue(asset_source)
        return cat.fingerprint(batch_items(cat, pose_ids, selection_mode, pose_id, order))


NODE_CLASS_MAPPINGS = {"PoseGalleryImage": PoseGalleryImage, "PoseGalleryBatch": PoseGalleryBatch}
NODE_DISPLAY_NAME_MAPPINGS = {"PoseGalleryImage": "Galeria de poses · imagem única",
                              "PoseGalleryBatch": "Galeria de poses · lote"}
