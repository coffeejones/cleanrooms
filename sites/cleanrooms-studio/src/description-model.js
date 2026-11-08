/* Canonical rich descriptions and a DOM-only, non-persistent reading preview. */
(() => {
  'use strict';

  const FONT_FAMILIES = Object.freeze(['sans-serif','Arial','Georgia','Courier New']);
  const FONT_SIZES = Object.freeze(['12px','14px','16px','18px','24px','32px']);
  const COLORS = Object.freeze(['#30353c','#5d6672','#bb594f','#b1843e','#527bb6','#8d79a8']);
  const HIGHLIGHTS = Object.freeze(['#fff2bf','#e5edf8','#eee7f6','#f6e4df']);
  const BLOCKS = new Set(['paragraph','heading','bulletList','orderedList','taskList','blockquote','codeBlock','horizontalRule']);
  const MARK_ORDER = ['bold','italic','underline','strike','code','link','textStyle'];
  const MAX_DEPTH = 64;
  const MAX_NODES = 100000;
  const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const inline = node => node.type === 'text' || node.type === 'hardBreak';
  const paragraph = content => content.length ? {type:'paragraph',content} : {type:'paragraph'};

  function href(value) {
    if (typeof value !== 'string') return null;
    const candidate = value.trim();
    if (!/^(?:https?:|mailto:|tel:)/i.test(candidate) || /[\u0000-\u0020\u007f]/.test(candidate)) return null;
    try {
      if (typeof URL === 'function') {
        const url = new URL(candidate);
        if (!['http:','https:','mailto:','tel:'].includes(url.protocol)) return null;
        if (['http:','https:'].includes(url.protocol) && !url.hostname) return null;
        if (['mailto:','tel:'].includes(url.protocol) && !url.pathname) return null;
        return url.href;
      }
      // The standalone module can also run in DOM-free VM contexts without URL.
      if (/^https?:/i.test(candidate) && !/^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(candidate)) return null;
      if (/^(?:mailto:|tel:)$/i.test(candidate)) return null;
      return candidate.replace(/^[^:]+:/, scheme => scheme.toLowerCase());
    } catch { return null; }
  }

  function paletteColor(raw, palette) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim().toLowerCase();
    if (palette.includes(value)) return value;
    const match = /^(rgba?)\(([^()]*)\)$/.exec(value);
    if (!match) return null;
    let channels, alpha;
    if (match[2].includes(',')) {
      const parts = match[2].split(',').map(part => part.trim());
      if (parts.length !== (match[1] === 'rgba' ? 4 : 3)) return null;
      channels = parts.slice(0,3); alpha = parts[3];
    } else {
      const parts = match[2].trim().split(/\s*\/\s*/);
      if (parts.length > 2 || match[1] === 'rgba' && parts.length !== 2) return null;
      channels = parts[0].split(/\s+/); alpha = parts[1];
    }
    if (channels.length !== 3 || channels.some(channel => !/^\d+(?:\.0+)?$/.test(channel) || Number(channel) > 255)) return null;
    if (alpha !== undefined && !/^1(?:\.0+)?$/.test(alpha)) return null;
    const color = '#' + channels.map(channel => Number(channel).toString(16).padStart(2,'0')).join('');
    return palette.includes(color) ? color : null;
  }

  function styleAttrs(raw) {
    const attrs = record(raw) ? raw : {}, safe = {};
    if (typeof attrs.fontFamily === 'string') {
      const family = attrs.fontFamily.trim().replace(/^(['"])(.*)\1$/, '$2');
      const canonical = FONT_FAMILIES.find(value => value.toLowerCase() === family.toLowerCase());
      if (canonical) safe.fontFamily = canonical;
      else if (['system','system-ui'].includes(family.toLowerCase())) safe.fontFamily = 'sans-serif';
    }
    const size = typeof attrs.fontSize === 'number' ? attrs.fontSize + 'px' : attrs.fontSize;
    if (FONT_SIZES.includes(size)) safe.fontSize = size;
    const color = paletteColor(attrs.color,COLORS), background = paletteColor(attrs.backgroundColor,HIGHLIGHTS);
    if (color) safe.color = color;
    if (background) safe.backgroundColor = background;
    return safe;
  }

  function marks(raw) {
    if (!Array.isArray(raw)) return [];
    const safe = new Map();
    for (const mark of raw) {
      if (!record(mark) || !MARK_ORDER.includes(mark.type)) continue;
      if (mark.type === 'link') {
        const link = href(mark.attrs?.href);
        if (link) safe.set(mark.type,{type:'link',attrs:{href:link,target:'_blank',rel:'noopener noreferrer'}});
      } else if (mark.type === 'textStyle') {
        const attrs = styleAttrs(mark.attrs);
        if (Object.keys(attrs).length) safe.set(mark.type,{type:'textStyle',attrs});
      } else safe.set(mark.type,{type:mark.type});
    }
    // Tiptap's inline code mark excludes other formatting marks.
    if (safe.has('code')) return [{type:'code'}];
    return MARK_ORDER.filter(type => safe.has(type)).map(type => safe.get(type));
  }

  function blockAttrs(raw, initial = {}) {
    const attrs = record(raw) ? raw : {}, safe = {...initial};
    if (['center','right','justify'].includes(attrs.textAlign)) safe.textAlign = attrs.textAlign;
    return safe;
  }

  function withContent(type, content, attrs = {}) {
    return {type,...(Object.keys(attrs).length ? {attrs} : {}),...(content.length ? {content} : {})};
  }

  function plainNode(node) {
    if (node.type === 'text') return node.text;
    if (node.type === 'hardBreak') return '\n';
    const content = node.content || [];
    return content.map(plainNode).join(['paragraph','heading','codeBlock'].includes(node.type) ? '' : '\n');
  }

  function mergeInline(nodes) {
    const result = [];
    for (const node of nodes) {
      const previous = result[result.length - 1];
      if (node.type === 'text' && previous?.type === 'text' && JSON.stringify(previous.marks || []) === JSON.stringify(node.marks || [])) previous.text += node.text;
      else result.push(node.type === 'text' ? {...node} : node);
    }
    return result;
  }

  function toInline(nodes) {
    const result = [];
    let afterBlock = false;
    for (const node of nodes) {
      if (inline(node)) {
        if (afterBlock && result.length) result.push({type:'hardBreak'});
        result.push(node); afterBlock = false;
      } else {
        if (result.length) result.push({type:'hardBreak'});
        const value = plainNode(node);
        if (value) result.push({type:'text',text:value});
        afterBlock = true;
      }
    }
    return mergeInline(result);
  }

  function toBlocks(nodes) {
    const result = [], pending = [];
    const flush = () => { if (pending.length) result.push(paragraph(mergeInline(pending.splice(0)))); };
    for (const node of nodes) {
      if (inline(node)) pending.push(node);
      else {
        flush();
        if (BLOCKS.has(node.type)) result.push(node);
        else if (['doc','listItem','taskItem'].includes(node.type)) result.push(...toBlocks(node.content || []));
      }
    }
    flush(); return result;
  }

  function itemContent(nodes) {
    const content = toBlocks(nodes);
    if (content[0]?.type !== 'paragraph') content.unshift(paragraph([]));
    return content;
  }

  function listItems(nodes, type) {
    const result = [], pending = [];
    const item = content => withContent(type,itemContent(content),type === 'taskItem' ? {checked:false} : {});
    const flush = () => { if (pending.length) result.push(item(pending.splice(0))); };
    for (const node of nodes) {
      if (inline(node)) pending.push(node);
      else {
        flush();
        result.push(item(['listItem','taskItem'].includes(node.type) ? node.content || [] : [node]));
      }
    }
    flush(); return result;
  }

  function normalize(raw) {
    try {
      const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!record(input) || input.type !== 'doc' || (input.content !== undefined && !Array.isArray(input.content))) return null;
      const path = new WeakSet();
      let count = 0;
      function children(node, depth) {
        if (node.content === undefined) return [];
        if (!Array.isArray(node.content)) throw new TypeError('Invalid rich-text content.');
        return node.content.flatMap(child => visit(child,depth + 1));
      }
      function visit(node, depth) {
        if (!record(node)) return [];
        if (depth > MAX_DEPTH || ++count > MAX_NODES || path.has(node)) throw new RangeError('Description structure is too deeply nested.');
        path.add(node);
        let result;
        if (node.type === 'text') {
          const safe = marks(node.marks);
          result = typeof node.text === 'string' && node.text.length ? [{type:'text',text:node.text,...(safe.length ? {marks:safe} : {})}] : [];
        } else if (node.type === 'hardBreak' || node.type === 'horizontalRule') result = [{type:node.type}];
        else {
          const content = children(node,depth);
          switch (node.type) {
            case 'paragraph': result = [withContent('paragraph',toInline(content),blockAttrs(node.attrs))]; break;
            case 'heading': {
              const requested = Number(node.attrs?.level), level = Number.isInteger(requested) ? Math.max(1,Math.min(3,requested)) : 1;
              result = [withContent('heading',toInline(content),blockAttrs(node.attrs,{level}))]; break;
            }
            case 'codeBlock': {
              const text = toInline(content).map(plainNode).join('');
              result = [withContent('codeBlock',text ? [{type:'text',text}] : [])]; break;
            }
            case 'blockquote': result = [withContent('blockquote',toBlocks(content).length ? toBlocks(content) : [paragraph([])])]; break;
            case 'bulletList': result = listItems(content,'listItem'); result = result.length ? [withContent('bulletList',result)] : []; break;
            case 'orderedList': {
              const start = node.attrs?.start, attrs = Number.isSafeInteger(start) && start > 1 ? {start} : {};
              result = listItems(content,'listItem'); result = result.length ? [withContent('orderedList',result,attrs)] : []; break;
            }
            case 'taskList': result = listItems(content,'taskItem'); result = result.length ? [withContent('taskList',result)] : []; break;
            case 'listItem': result = [withContent('listItem',itemContent(content))]; break;
            case 'taskItem': result = [withContent('taskItem',itemContent(content),{checked:false})]; break;
            default: result = content; // Unsupported wrappers contribute only sanitized children.
          }
        }
        path.delete(node); return result;
      }
      path.add(input);
      const content = toBlocks(children(input,0));
      return {type:'doc',content:content.length ? content : [paragraph([])]};
    } catch { return null; }
  }

  function meaningful(doc) {
    if (plainNode(doc).trim()) return true;
    const containsRule = node => node.type === 'horizontalRule' || (node.content || []).some(containsRule);
    return containsRule(doc);
  }

  function encode(raw) { const doc = normalize(raw); return doc && meaningful(doc) ? JSON.stringify(doc) : ''; }
  function hasContent(raw) { const doc = normalize(raw); return Boolean(doc && meaningful(doc)); }
  function text(raw) { const doc = normalize(raw); return doc ? plainNode(doc) : ''; }
  function fromText(value) {
    const source = typeof value === 'string' ? value : '';
    return {type:'doc',content:source.split('\n').map(line => paragraph(line ? [{type:'text',text:line}] : []))};
  }

  function render(container, raw, options = {}) {
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('A DOM container is required.');
    const document = container.ownerDocument || globalThis.document;
    const doc = normalize(raw), tasks = [];
    let checked = 0;
    const report = () => { if (typeof options.onTaskChange === 'function') options.onTaskChange({checked,total:tasks.length}); };
    function element(tag) { return document.createElement(tag); }
    function applyBlockAttrs(target, attrs = {}) {
      if (attrs.textAlign) target.style.textAlign = attrs.textAlign;
    }
    function marked(node) {
      const leaf = document.createTextNode(node.text);
      let result = leaf;
      for (const mark of [...(node.marks || [])].reverse()) {
        const tag = {bold:'strong',italic:'em',underline:'u',strike:'s',code:'code',link:'a',textStyle:'span'}[mark.type];
        const wrapper = element(tag);
        if (mark.type === 'link') for (const [name,value] of Object.entries(mark.attrs)) wrapper.setAttribute(name,value);
        if (mark.type === 'textStyle') for (const [name,value] of Object.entries(mark.attrs)) wrapper.style[name] = value;
        wrapper.append(result); result = wrapper;
      }
      return result;
    }
    function build(node) {
      if (node.type === 'text') return marked(node);
      if (node.type === 'hardBreak') return element('br');
      if (node.type === 'taskItem') {
        const row = element('li'), label = element('label'), input = element('input'), body = element('div');
        row.dataset.type = 'taskItem'; row.dataset.checked = 'false';
        input.type = 'checkbox'; input.checked = false; input.disabled = options.interactiveTasks !== true;
        const taskText = plainNode(node).replace(/\s+/g,' ').trim();
        input.setAttribute('aria-label',taskText ? 'Markér opgave som udført: ' + taskText.slice(0,160) + (taskText.length > 160 ? '…' : '') : 'Markér opgave som udført');
        body.className = 'cs-description-task-content';
        for (const child of node.content || []) body.append(build(child));
        label.append(input); row.append(label,body); tasks.push(input);
        if (options.interactiveTasks === true) input.addEventListener('change',() => {
          row.dataset.checked = String(input.checked); row.classList.toggle('is-complete',input.checked);
          checked = tasks.reduce((total,task) => total + Number(task.checked),0); report();
        });
        return row;
      }
      const tag = {paragraph:'p',heading:'h' + node.attrs?.level,bulletList:'ul',orderedList:'ol',listItem:'li',taskList:'ul',blockquote:'blockquote',codeBlock:'pre',horizontalRule:'hr'}[node.type];
      const target = element(tag);
      applyBlockAttrs(target,node.attrs);
      if (node.type === 'taskList') target.dataset.type = 'taskList';
      if (node.type === 'orderedList' && node.attrs?.start) target.setAttribute('start',String(node.attrs.start));
      if (node.type === 'codeBlock') {
        const code = element('code'); code.textContent = plainNode(node); target.append(code);
      } else for (const child of node.content || []) target.append(build(child));
      return target;
    }
    container.replaceChildren(...(doc ? doc.content.map(build) : []));
    report();
    return {element:container,checked,total:tasks.length};
  }

  const api = Object.freeze({FONT_FAMILIES,FONT_SIZES,COLORS,HIGHLIGHTS,normalize,encode,fromText,text,hasContent,render});
  globalThis.CleanRoomsDescription = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
