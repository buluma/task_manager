/* A small stand-in for the DOM, enough for the drag and drop handlers (drag-drop.test.js): elements with classes,
   data attributes, a parent and children, and the simple selectors those handlers use (.class, [data-x], :not(),
   and comma lists). `rect` is what getBoundingClientRect returns. */
const camel = s => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

function matches(el, sel) {
  return sel.split(',').some(one => {
    const parts = [...one.trim().matchAll(/\.([\w-]+)|\[([\w-]+)\]|:not\(([^)]+)\)/g)];
    return (
      parts.length > 0 &&
      parts.every(([, cls, attr, not]) => (cls ? el.classList.contains(cls) : attr ? camel(attr.slice(5)) in el.dataset : !matches(el, not)))
    );
  });
}

export class El {
  constructor(cls = '', data = {}, children = []) {
    this.classes = new Set(cls.split(' ').filter(Boolean));
    this.dataset = { ...data };
    this.parentNode = null;
    this.children = [];
    this.rect = { top: 0, height: 0 };
    const set = this.classes;
    this.classList = { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) };
    children.forEach(c => this.append(c));
  }
  append(c) {
    c.parentNode = this;
    this.children.push(c);
    return this;
  }
  get nextSibling() {
    const sibs = this.parentNode?.children || [];
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  insertBefore(node, ref) {
    if (!(node instanceof El)) return node;
    node.remove();
    node.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }
  contains(el) {
    for (let x = el; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  closest(sel) {
    for (let x = this; x; x = x.parentNode) if (matches(x, sel)) return x;
    return null;
  }
  querySelectorAll(sel) {
    return this.children.flatMap(c => [...(matches(c, sel) ? [c] : []), ...c.querySelectorAll(sel)]);
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
}
