import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { Gallery } from "./lib/gallery.js";

const TYPES = new Set(["PoseGalleryImage", "PoseGalleryBatch"]);
const previews = new WeakMap();
const graphIds = new WeakMap();
let nextGraphId = 0;
const labels = { pose_id: "ID da imagem", pose_ids: "Lista de IDs", asset_source: "Acervo", resize_mode: "Tamanho", width: "Largura", height: "Altura", flip_horizontal: "Espelhar na horizontal", selection_mode: "Modo de seleção", order: "Ordenação" };
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./gallery.css", import.meta.url).href;
document.head.append(stylesheet);

function widget(node, name) { return node.widgets?.find(value => value.name === name); }
function graphs() {
    return [...new Set([app.canvas?.graph, app.graph].filter(Boolean))];
}
function targets() {
    return graphs().flatMap(graph => {
        if (!graphIds.has(graph)) graphIds.set(graph, ++nextGraphId);
        return (graph._nodes || []).filter(node => TYPES.has(node.comfyClass || node.type)).map(node => ({
            id: graphIds.get(graph) + ":" + node.id, displayId: node.id, title: node.title, node, graph,
        }));
    });
}
function targetFor(node) { return targets().find(target => target.node === node)?.id || ""; }
function changed() { window.dispatchEvent(new Event("pose-gallery-nodes-changed")); }

const adapter = {
    async request(path, options = {}) {
        const init = { ...options };
        if (options.body) { init.body = JSON.stringify(options.body); init.headers = { ...options.headers, "Content-Type": "application/json" }; }
        const response = await api.fetchApi("/pose_gallery" + path, init);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "A galeria não respondeu. Verifique se o ComfyUI está rodando.");
        return result;
    },
    image(source, id, thumbnail = false) {
        return api.apiURL("/pose_gallery/image?" + new URLSearchParams({ source, id, kind: thumbnail ? "thumb" : "original" }));
    },
    targets,
    apply({ ids, mode, source, targetId }) {
        const target = targetId ? targets().find(value => value.id === targetId) : null;
        if (targetId && !target) throw new Error("O nó de destino foi removido. Escolha outro nó para receber as imagens.");
        let node = target?.node;
        const graph = target?.graph || app.canvas?.graph || app.graph;
        if (!graph) throw new Error("Abra um fluxo de trabalho primeiro.");
        if (node && (node.comfyClass || node.type) === "PoseGalleryImage" && ids.length > 1) {
            throw new Error("O nó de imagem única recebe só uma imagem. Use o nó de lote ou escolha «Criar novo nó da galeria».");
        }
        const batch = node ? (node.comfyClass || node.type) === "PoseGalleryBatch" : mode === "batch";
        const values = { asset_source: source === "custom" ? "Biblioteca personalizada" : "Biblioteca interna", pose_id: ids[0] };
        if (batch) Object.assign(values, { pose_ids: ids.join("\n"), selection_mode: "Seleção manual" });
        for (const name of Object.keys(values)) {
            if (node?.inputs?.some(input => input.name === name && input.link != null)) {
                throw new Error("A entrada «" + (labels[name] || name) + "» do nó de destino vem de uma conexão. Desconecte-a ou crie um novo nó da galeria.");
            }
        }
        graph.beforeChange?.();
        try {
            if (!node) {
                node = window.LiteGraph?.createNode(batch ? "PoseGalleryBatch" : "PoseGalleryImage");
                if (!node) throw new Error("Os nós da galeria ainda não estão registrados. Atualize a página do ComfyUI e tente de novo.");
                const canvas = app.canvas;
                const scale = canvas?.ds?.scale || 1;
                const offset = canvas?.ds?.offset || [0, 0];
                node.pos = [Math.max(0, (canvas?.canvas?.clientWidth || 900) / (2 * scale) - offset[0] - 170), Math.max(0, (canvas?.canvas?.clientHeight || 700) / (2 * scale) - offset[1] - 160)];
                graph.add(node);
            }
            for (const [name, value] of Object.entries(values)) {
                const input = widget(node, name);
                if (input) { input.value = value; input.callback?.(value); }
            }
            previews.get(node)?.();
            graph.setDirtyCanvas?.(true, true);
        } finally { graph.afterChange?.(); }
        changed();
        return node;
    },
    expand(state = {}) {
        const dialog = document.createElement("dialog");
        dialog.className = "pg-dialog pg-expanded";
        dialog.setAttribute("aria-label", "Seletor da galeria de poses");
        const header = document.createElement("header"); header.className = "pg-dialog-header";
        const title = document.createElement("h2"); title.textContent = "Galeria de poses";
        const close = document.createElement("button"); close.type = "button"; close.className = "pg-button pg-quiet"; close.textContent = "Voltar ao fluxo ×";
        close.addEventListener("click", () => dialog.close()); header.append(title, close);
        const host = document.createElement("div"); host.className = "pg-expanded-host";
        dialog.append(header, host); document.body.append(dialog);
        const gallery = new Gallery(host, { ...adapter, expand() {} }, { ...state, expanded: true });
        dialog.addEventListener("close", () => { gallery.destroy(); dialog.remove(); }, { once: true });
        dialog.showModal();
        return gallery;
    },
};

app.registerExtension({
    name: "ComfyUI_Pose-Gallery.Gallery",
    setup() {
        let sidebar;
        if (app.extensionManager?.registerSidebarTab) {
            app.extensionManager.registerSidebarTab({
                id: "ComfyUI_Pose-Gallery", icon: "pi pi-images", title: "Galeria de poses", tooltip: "Galeria de poses · referências em português", type: "custom",
                render(host) {
                    Object.assign(host.style, { height: "100%", minHeight: "0", overflow: "hidden" });
                    if (sidebar?.host === host && host.querySelector(".pg-app")) return;
                    const state = sidebar ? { ...sidebar.state, selectedIds: [...sidebar.selected.keys()] } : {};
                    sidebar?.destroy();
                    sidebar = new Gallery(host, adapter, state);
                },
            });
        }
    },
    nodeCreated(node) {
        if (!TYPES.has(node.comfyClass || node.type)) return;
        for (const input of node.widgets || []) if (labels[input.name]) input.label = labels[input.name];
        const open = node.addWidget("button", "Abrir galeria de poses", null, () => adapter.expand({
            source: widget(node, "asset_source")?.value === "Biblioteca personalizada" ? "custom" : "builtin", targetId: targetFor(node),
        }), { serialize: false });
        open.options = { ...open.options, serialize: false };
        const element = document.createElement("div"); element.className = "pg-node-preview";
        const image = document.createElement("img"); image.alt = "Prévia da pose atual";
        const caption = document.createElement("span"); element.append(image, caption);
        image.addEventListener("error", () => { image.hidden = true; caption.textContent += " · imagem ausente, escolha outra"; });
        const previewWidget = node.addDOMWidget("pose_gallery_preview", "image", element, { serialize: false, hideOnZoom: false });
        previewWidget.computeSize = () => [330, 180];
        previewWidget.options = { ...previewWidget.options, serialize: false, getMinHeight: () => 180, getMaxHeight: () => 180 };
        let timer;
        const refresh = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const source = widget(node, "asset_source")?.value === "Biblioteca personalizada" ? "custom" : "builtin";
                const manualBatch = (node.comfyClass || node.type) === "PoseGalleryBatch" && widget(node, "selection_mode")?.value === "Seleção manual";
                const ids = String(widget(node, manualBatch ? "pose_ids" : "pose_id")?.value || "").trim().split(/[\s,;]+/).filter(Boolean);
                const id = ids[0];
                image.hidden = !id;
                if (id) image.src = adapter.image(source, id, true);
                image.style.transform = widget(node, "flip_horizontal")?.value ? "scaleX(-1)" : "";
                caption.textContent = (id || "abra a galeria para escolher") + (manualBatch ? " · " + new Set(ids).size + " imagens" : (node.comfyClass || node.type) === "PoseGalleryBatch" ? " · todos os ângulos disponíveis" : "");
            }, 60);
        };
        previews.set(node, refresh);
        for (const input of node.widgets || []) {
            if (!labels[input.name]) continue;
            const previous = input.callback;
            input.callback = function (...args) { const result = previous?.apply(this, args); refresh(); return result; };
        }
        node.setSize([Math.max(node.size[0], 340), Math.max(node.size[1], node.computeSize()[1])]);
        refresh(); queueMicrotask(changed);
    },
    afterConfigureGraph() {
        for (const { node } of targets()) previews.get(node)?.();
        changed();
    },
});
