"""Catalogue and local configuration shared by nodes and HTTP routes."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import unicodedata
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANGLE_ORDER = ("Frente", "Diagonal", "Perfil", "De cima", "De baixo")
SOURCES = ("Biblioteca interna", "Biblioteca personalizada")
SOURCE_KEYS = {"Biblioteca interna": "builtin", "Biblioteca personalizada": "custom",
               "builtin": "builtin", "custom": "custom"}
DEFAULT_ID = "full_single_P001_front"
MAX_BATCH = 32
MAX_BATCH_PIXELS = 32_000_000
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


class GalleryError(ValueError):
    """An actionable error safe to show in the UI."""


def fold(text: str) -> str:
    # Portuguese searches must match with or without accents, so the index is folded.
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))


def config_path() -> Path:
    # Keep machine-specific paths outside the Git checkout when ComfyUI is available.
    try:
        import folder_paths
        return Path(folder_paths.get_user_directory()) / "pose_gallery" / "settings.json"
    except (ImportError, AttributeError):
        return ROOT / ".pose-gallery.settings.json"


def read_settings() -> dict:
    path = config_path()
    if not path.is_file():
        return {"custom_directory": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        directory = data.get("custom_directory", "")
        if not isinstance(directory, str):
            raise ValueError("o diretório deve ser texto")
        return {"custom_directory": directory}
    except (OSError, ValueError, AttributeError) as exc:
        raise GalleryError(f"Não foi possível ler as configurações da galeria: {path}. Verifique ou remova esse arquivo.") from exc


def save_settings(directory: str) -> dict:
    if not isinstance(directory, str):
        raise GalleryError("O diretório de acervo personalizado deve ser texto.")
    directory = directory.strip()
    if directory:
        root = Path(directory).expanduser()
        if not root.is_absolute():
            raise GalleryError("Informe um caminho absoluto no computador onde o ComfyUI roda.")
        root = root.resolve()
        # Validate before replacing the previous working configuration.
        cat = catalogue_at(root)
        for item in cat.items:
            cat.path(item)
        directory = str(root)
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    settings = {"custom_directory": directory}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="pose-gallery-", suffix=".tmp", delete=False) as stream:
            temporary = stream.name
            json.dump(settings, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return settings


def source_key(source: str) -> str:
    try:
        return SOURCE_KEYS[source]
    except (KeyError, TypeError) as exc:
        raise GalleryError("Acervo desconhecido. Escolha a biblioteca interna ou a personalizada.") from exc


def asset_root(source: str) -> Path:
    if source_key(source) == "builtin":
        return ROOT
    directory = read_settings()["custom_directory"]
    if not directory:
        raise GalleryError("Nenhum diretório personalizado configurado. Informe o diretório em «Acervo» na galeria de poses.")
    return Path(directory).resolve()


def safe_image_path(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise GalleryError("O caminho do arquivo não pode ficar vazio.")
    # JSON paths are relative to the library root, on every operating system.
    if "\\" in value or value.startswith("/") or re.match(r"^[a-zA-Z]:", value):
        raise GalleryError(f"Use caminhos relativos à raiz da biblioteca: {value}")
    path = (root / value).resolve()
    if not path.is_relative_to(root.resolve()) or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise GalleryError(f"Caminho de arquivo inválido: {value}")
    return path


class Catalogue:
    def __init__(self, root: Path, signature: tuple):
        self.root = root.resolve()
        self.signature = signature
        manifest = self.root / "data" / "pose-pt.json"
        try:
            rows = json.loads(manifest.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise GalleryError("Não foi possível ler data/pose-pt.json. Verifique a estrutura do diretório e o formato do JSON.") from exc
        if not isinstance(rows, list) or not rows:
            raise GalleryError("data/pose-pt.json deve ser uma lista não vazia de registros de imagem.")
        self.items = []
        self.by_id = {}
        self.groups = {}
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise GalleryError(f"O registro {index + 1} deve ser um objeto.")
            required = ("id", "serie", "numero", "categoria", "nome", "angulo", "original")
            for key in required:
                if not isinstance(row.get(key), str) or not row[key].strip():
                    raise GalleryError(f"O registro {index + 1} não tem o campo de texto: {key}")
            if row["id"] in self.by_id:
                raise GalleryError(f"ID de imagem repetido: {row['id']}")
            original = row["original"]
            thumbnail = row.get("miniatura") or original
            safe_image_path(self.root, original)
            safe_image_path(self.root, thumbnail)
            item = {key: row[key] for key in required}
            item["miniatura"] = thumbnail
            item["busca"] = fold(" ".join(item[key] for key in required if key != "original"))
            self.items.append(item)
            self.by_id[item["id"]] = item
            self.groups.setdefault((item["serie"], item["numero"]), []).append(item)
        for group in self.groups.values():
            group.sort(key=lambda item: angle_rank(item["angulo"]))

    def item(self, pose_id: str) -> dict:
        try:
            return self.by_id[pose_id]
        except (KeyError, TypeError) as exc:
            raise GalleryError(f"A imagem «{pose_id}» não existe nesta biblioteca. Escolha outra imagem ou confira o acervo selecionado.") from exc

    def path(self, item: dict, thumbnail: bool = False) -> Path:
        path = safe_image_path(self.root, item["miniatura" if thumbnail else "original"])
        if thumbnail and not path.is_file():
            path = safe_image_path(self.root, item["original"])
        if not path.is_file():
            raise GalleryError(f"Arquivo de imagem ausente: {path.name}. Verifique se o acervo está completo.")
        return path

    def group(self, pose_id: str) -> list[dict]:
        item = self.item(pose_id)
        return self.groups[(item["serie"], item["numero"])]

    def fingerprint(self, items: list[dict]) -> str:
        parts = [str(self.root), repr(self.signature)]
        for item in items:
            path = self.path(item)
            stat = path.stat()
            parts.extend((item["id"], str(stat.st_mtime_ns), str(stat.st_size)))
        return hashlib.sha256("|".join(parts).encode()).hexdigest()


def angle_rank(angle: str) -> int:
    return ANGLE_ORDER.index(angle) if angle in ANGLE_ORDER else len(ANGLE_ORDER)


@lru_cache(maxsize=8)
def _catalogue_cached(root: str, signature: tuple) -> Catalogue:
    return Catalogue(Path(root), signature)


def catalogue_at(root: Path) -> Catalogue:
    manifest = root / "data" / "pose-pt.json"
    try:
        stat = manifest.stat()
    except OSError as exc:
        raise GalleryError("data/pose-pt.json não foi encontrado no diretório. Informe um diretório com data, img e thumbs.") from exc
    return _catalogue_cached(str(root.resolve()), (stat.st_mtime_ns, stat.st_size))


def catalogue(source: str = "builtin") -> Catalogue:
    return catalogue_at(asset_root(source))


def parse_ids(value: str) -> list[str]:
    if not isinstance(value, str):
        raise GalleryError("A lista de IDs deve ser texto.")
    ids = list(dict.fromkeys(part for part in re.split(r"[\s,;]+", value.strip()) if part))
    if not ids:
        raise GalleryError("Escolha pelo menos uma imagem na galeria.")
    if len(ids) > MAX_BATCH:
        raise GalleryError(f"No máximo {MAX_BATCH} imagens por lote. Reduza a seleção.")
    return ids


def batch_items(cat: Catalogue, pose_ids: str, selection_mode: str, pose_id: str, order: str) -> list[dict]:
    if selection_mode == "Todos os ângulos da pose":
        items = list(cat.group(pose_id))
    elif selection_mode == "Seleção manual":
        items = [cat.item(value) for value in parse_ids(pose_ids)]
    else:
        raise GalleryError("Modo de seleção em lote desconhecido.")
    if len(items) > MAX_BATCH:
        raise GalleryError(f"No máximo {MAX_BATCH} imagens por lote. Reduza a seleção.")
    if order == "Ordem por ângulo":
        items.sort(key=lambda item: (item["serie"], item["numero"], angle_rank(item["angulo"])))
    elif order == "Ordem por ID":
        items.sort(key=lambda item: item["id"])
    elif order != "Ordem de seleção":
        raise GalleryError("Modo de ordenação desconhecido.")
    return items
