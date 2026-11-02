export const ANGLES = ["Frente", "Diagonal", "Perfil", "De cima", "De baixo"];
export const MAX_BATCH = 32;
const PREFIX = "pose-gallery-pt.v1.";

export function fold(text) {
    // Portuguese searches must match with or without accents, like the backend index.
    return text.toLocaleLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function readLocal(name, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(PREFIX + name));
        return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : (value ?? fallback);
    } catch { return fallback; }
}

export function writeLocal(name, value) {
    try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); }
    catch { /* Storage may be unavailable in a private browser session. */ }
}

export function groupKey(item) { return JSON.stringify([item.serie, item.numero]); }
export function angleRank(item) {
    const index = ANGLES.indexOf(item.angulo);
    return index < 0 ? ANGLES.length : index;
}

export function buildGroups(items) {
    const groups = new Map();
    for (const item of items) {
        const key = groupKey(item);
        if (!groups.has(key)) groups.set(key, { key, items: [], representative: item });
        groups.get(key).items.push(item);
    }
    for (const group of groups.values()) {
        group.items.sort((a, b) => angleRank(a) - angleRank(b));
        group.representative = group.items[0];
    }
    return groups;
}

export function filterItems(items, state, favorites, recent) {
    const words = fold(state.query.trim()).split(/\s+/).filter(Boolean);
    const favoriteSet = new Set(favorites);
    const recentSet = new Set(recent);
    const result = items.filter(item =>
        (!state.system || item.serie === state.system) &&
        (!state.category || item.categoria === state.category) &&
        (!state.angle || item.angulo === state.angle) &&
        (state.collection !== "favorites" || favoriteSet.has(item.id)) &&
        (state.collection !== "recent" || recentSet.has(item.id)) &&
        words.every(word => item.busca.includes(word)));
    if (state.collection === "recent") {
        const rank = new Map(recent.map((id, index) => [id, index]));
        result.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    }
    return result;
}

export function listEntries(items, grouped) {
    if (!grouped) return items.map(item => ({ key: item.id, item, matches: [item] }));
    const entries = new Map();
    for (const item of items) {
        const key = groupKey(item);
        if (!entries.has(key)) entries.set(key, { key, item, matches: [] });
        entries.get(key).matches.push(item);
    }
    return [...entries.values()];
}
