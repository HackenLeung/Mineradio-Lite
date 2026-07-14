/** 极简事件总线 */
const map = new Map();

export const bus = {
  on(type, fn) {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
    return () => map.get(type)?.delete(fn);
  },
  emit(type, payload) {
    const set = map.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error('[bus]', type, e); }
    }
  },
};