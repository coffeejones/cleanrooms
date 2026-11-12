import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin } from '@tiptap/pm/state';

let nextId = 0;
const ICONS = {
  undo:'M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14',
  redo:'m15 14 5-5-5-5m5 5h-9a7 7 0 0 0 0 14',
  left:'M4 5h16M4 10h10M4 15h16M4 20h10',
  center:'M4 5h16M7 10h10M4 15h16M7 20h10',
  right:'M4 5h16M10 10h10M4 15h16M10 20h10',
  justify:'M4 5h16M4 10h16M4 15h16M4 20h16',
  bullet:'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  ordered:'M10 6h10M10 12h10M10 18h10M3 4h1v4M3 11c2-2 4 1 1 2l-1 1h3M3 17h2l-1 1c3 0 2 3-1 2',
  indent:'M10 5h10M10 19h10M13 10h7M13 14h7m-9-5 3 3-3 3M3 12h5',
  outdent:'M10 5h10M10 19h10M13 10h7M13 14h7m-5-5-3 3 3 3M3 12h5',
  task:'m3 6 1 1 2-3M10 6h10M3 11h4v4H3zM10 13h10M3 19h4M10 19h10',
  link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  clear:'m5 4 12 0m-6 0-4 15M4 19h8m3-7 6 6m0-6-6 6',
  close:'m6 6 12 12M18 6 6 18',
  highlight:'m4 15 9-11 7 6-10 10-6-5Zm-1 6h8',
};

function safeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || /[\u0000-\u0020<>]/.test(value)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : 'https://' + value;
  try {
    const parsed = new URL(candidate);
    if (!['https:','http:','mailto:','tel:'].includes(parsed.protocol)) return null;
    if (['http:','https:'].includes(parsed.protocol) && !parsed.hostname) return null;
    if (['mailto:','tel:'].includes(parsed.protocol) && !parsed.pathname.trim()) return null;
    return parsed.href;
  } catch { return null; }
}

/* The author edits a checklist template, never a colleague's completion state. */
const TemplateTaskItem = TaskItem.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('li'), label = document.createElement('label');
      const checkbox = document.createElement('input'), contentDOM = document.createElement('div');
      dom.dataset.type = 'taskItem'; dom.dataset.checked = 'false';
      label.contentEditable = 'false'; checkbox.type = 'checkbox'; checkbox.disabled = true;
      checkbox.tabIndex = -1; checkbox.setAttribute('aria-label','Opgave i skabelon. Prøv afkrydsning i forhåndsvisningen.');
      contentDOM.className = 'cs-description-task-content'; label.append(checkbox); dom.append(label,contentDOM);
      return {dom,contentDOM,update(updated) { return updated.type === node.type; }};
    };
  },
});
const TemplateTasks = Extension.create({
  name:'cleanroomsTaskTemplate',
  addProseMirrorPlugins() {
    return [new Plugin({appendTransaction(transactions,oldState,state) {
      if (!transactions.some(transaction => transaction.docChanged)) return null;
      let transaction = null;
      state.doc.descendants((node,position) => {
        if (node.type.name === 'taskItem' && node.attrs.checked) {
          transaction ||= state.tr;
          transaction.setNodeMarkup(position,undefined,{...node.attrs,checked:false});
        }
      });
      return transaction;
    }})];
  },
});

/* Normalize only text-style marks, preserving text positions and selection. */
const AllowedTextStyles = Extension.create({
  name:'cleanroomsAllowedTextStyles',
  addProseMirrorPlugins() {
    return [new Plugin({appendTransaction(transactions,oldState,state) {
      if (!transactions.some(transaction => transaction.docChanged)) return null;
      const Model = globalThis.CleanRoomsDescription, styles = new Map();
      let transaction = null;
      state.doc.descendants((node,position) => {
        if (!node.isText) return;
        const mark = node.marks.find(item => item.type.name === 'textStyle');
        if (!mark) return;
        const key = JSON.stringify(mark.attrs);
        if (!styles.has(key)) {
          const normalized = Model.normalize({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x',marks:[mark.toJSON()]}]}]});
          const safe = normalized?.content?.[0]?.content?.[0]?.marks?.find(item => item.type === 'textStyle');
          styles.set(key,safe ? state.schema.marks.textStyle.create(safe.attrs || {}) : null);
        }
        const safeMark = styles.get(key);
        if (safeMark && mark.eq(safeMark)) return;
        transaction ||= state.tr;
        transaction.removeMark(position,position + node.nodeSize,mark);
        if (safeMark) transaction.addMark(position,position + node.nodeSize,safeMark);
      });
      return transaction;
    }})];
  },
});

export function mount({ element, sourceInput }) {
  const Model = globalThis.CleanRoomsDescription;
  if (!element || !sourceInput || !Model) throw new Error('Beskrivelseseditoren mangler et felt eller sin datamodel.');
  const doc = element.ownerDocument, id = 'cs-rich-' + (++nextId);
  let editor = null, disposed = false, loading = false, initialKey = '', openPopup = null;
  let original = {note:'',noteRich:''}, cached = {...original}, previewMode = false, previewDoc = null;
  const actions = [], swatches = [];
  const node = (tag,className,text) => { const result = doc.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result; };
  const icon = name => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg','svg'), path = doc.createElementNS(svg.namespaceURI,'path');
    Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}).forEach(([key,value]) => svg.setAttribute(key,String(value)));
    path.setAttribute('d',ICONS[name]); svg.append(path); return svg;
  };
  const button = (label,content,run,className = '') => {
    const control = node('button','cs-rich-button ' + className); control.type = 'button'; control.title = label; control.setAttribute('aria-label',label);
    control.append(typeof content === 'string' ? doc.createTextNode(content) : content);
    control.addEventListener('mousedown',event => event.preventDefault());
    control.addEventListener('click',event => { event.preventDefault(); run?.(); });
    return control;
  };
  const root = node('div','cs-rich-editor'), tabs = node('div','cs-rich-tabs');
  tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Beskrivelsesvisning');
  const editTab = button('Redigér beskrivelse','Redigér',() => setMode(false));
  const previewTab = button('Forhåndsvis beskrivelse','Forhåndsvisning',() => setMode(true));
  [editTab,previewTab].forEach((tab,index) => { tab.id = id + '-tab-' + index; tab.setAttribute('role','tab'); tab.setAttribute('aria-controls',id + '-panel-' + index); tabs.append(tab); });
  const author = node('div','cs-rich-author'), preview = node('div','cs-rich-preview');
  [author,preview].forEach((panel,index) => { panel.id = id + '-panel-' + index; panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',id + '-tab-' + index); });
  const toolbar = node('div','cs-rich-toolbar'); toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','Formatering af beskrivelse');
  const group = label => { const result = node('div','cs-rich-tool-group'); result.setAttribute('role','group'); result.setAttribute('aria-label',label); toolbar.append(result); return result; };
  const historyGroup = group('Fortryd og gentag');
  const undo = button('Fortryd · Ctrl/Cmd+Z',icon('undo'),() => editor?.chain().focus().undo().run());
  const redo = button('Gentag · Ctrl/Cmd+Shift+Z',icon('redo'),() => editor?.chain().focus().redo().run()); historyGroup.append(undo,redo);
  const typography = group('Skrift og afsnit');
  function select(label,className,options,change) {
    const control = node('select','cs-rich-select ' + className); control.title = label; control.setAttribute('aria-label',label);
    control.setAttribute('data-custom-select', '');
    options.forEach(([value,text]) => { const option = node('option','',text); option.value = value; control.append(option); });
    control.addEventListener('change',() => change(control.value)); typography.append(control); return control;
  }
  const families = Model.FONT_FAMILIES, sizes = Model.FONT_SIZES;
  const family = select('Skrifttype','cs-rich-family',families.map((value,index) => [value,['Standard','Arial','Georgia','Mono'][index] || value]),value => {
    const chain = editor?.chain().focus(); if (value === 'sans-serif') chain?.unsetFontFamily().run(); else chain?.setFontFamily(value).run();
  });
  const block = select('Afsnitstype','cs-rich-block',[['paragraph','Tekst'],['h2','Overskrift 2'],['h3','Overskrift 3']],value => {
    const chain = editor?.chain().focus(); if (value === 'paragraph') chain?.setParagraph().run(); else chain?.setHeading({level:Number(value.slice(1))}).run();
  });
  const size = select('Skriftstørrelse','cs-rich-size',sizes.map(value => [value,value.replace('px','')]),value => editor?.chain().focus().setFontSize(value).run());
  function action(parent,label,content,command,isActive,canRun) {
    const control = button(label,content,() => command());
    if (isActive) control.setAttribute('aria-pressed','false');
    actions.push({control,isActive,canRun}); parent.append(control); return control;
  }
  const formatting = group('Tekstformatering');
  action(formatting,'Fed · Ctrl/Cmd+B',node('strong','','B'),() => editor?.chain().focus().toggleBold().run(),() => editor?.isActive('bold'));
  action(formatting,'Kursiv · Ctrl/Cmd+I',node('em','','I'),() => editor?.chain().focus().toggleItalic().run(),() => editor?.isActive('italic'));
  action(formatting,'Understregning · Ctrl/Cmd+U',node('u','','U'),() => editor?.chain().focus().toggleUnderline().run(),() => editor?.isActive('underline'));
  action(formatting,'Gennemstregning',node('s','','S'),() => editor?.chain().focus().toggleStrike().run(),() => editor?.isActive('strike'));
  const colors = group('Tekstfarver');
  const colorGlyph = node('span','cs-rich-color-glyph','A'), highlightGlyph = icon('highlight');
  const colorButton = button('Tekstfarve',colorGlyph,() => togglePopup(colorPanel,colorButton));
  const highlightButton = button('Fremhævning',highlightGlyph,() => togglePopup(highlightPanel,highlightButton));
  [colorButton,highlightButton].forEach(control => { control.setAttribute('aria-haspopup','dialog'); control.setAttribute('aria-expanded','false'); }); colors.append(colorButton,highlightButton);
  const alignments = group('Tekstjustering');
  [['left','Venstrestillet'],['center','Centreret'],['right','Højrestillet'],['justify','Lige margener']].forEach(([value,label]) => action(alignments,label,icon(value),() => editor?.chain().focus().setTextAlign(value).run(),() => editor?.isActive({textAlign:value}) || value === 'left' && !editor?.getAttributes('paragraph').textAlign && !editor?.getAttributes('heading').textAlign));
  const lists = group('Lister');
  action(lists,'Punktopstilling',icon('bullet'),() => editor?.chain().focus().toggleBulletList().run(),() => editor?.isActive('bulletList'));
  action(lists,'Nummereret liste',icon('ordered'),() => editor?.chain().focus().toggleOrderedList().run(),() => editor?.isActive('orderedList'));
  action(lists,'Tjekliste som skabelon',icon('task'),() => editor?.chain().focus().toggleTaskList().run(),() => editor?.isActive('taskList'));
  const itemType = () => editor?.isActive('taskList') ? 'taskItem' : 'listItem';
  action(lists,'Ryk liste ind',icon('indent'),() => editor?.chain().focus().sinkListItem(itemType()).run(),null,() => editor?.can().sinkListItem(itemType()));
  action(lists,'Ryk liste ud',icon('outdent'),() => editor?.chain().focus().liftListItem(itemType()).run(),null,() => editor?.can().liftListItem(itemType()));
  const finalGroup = group('Links og formatering');
  const linkButton = action(finalGroup,'Indsæt eller redigér link',icon('link'),() => { linkInput.value = editor?.getAttributes('link').href || ''; linkError.hidden = true; togglePopup(linkPanel,linkButton); if (!linkPanel.hidden) linkInput.focus(); },() => editor?.isActive('link'));
  linkButton.setAttribute('aria-haspopup','dialog'); linkButton.setAttribute('aria-expanded','false');
  action(finalGroup,'Ryd formatering',icon('clear'),() => editor?.chain().focus().unsetAllMarks().clearNodes().run());
  const popups = node('div','cs-rich-popups');
  function popup(label) { const result = node('div','cs-rich-popup'); result.id = id + '-popup-' + popups.children.length; result.hidden = true; result.setAttribute('role','group'); result.setAttribute('aria-label',label); popups.append(result); return result; }
  function palette(label,values,command,attribute) {
    const panel = popup(label), caption = node('span','cs-rich-popup-caption',label), controls = node('div','cs-rich-swatches'); panel.append(caption,controls);
    values.forEach((value,index) => {
      const control = button(label + ' ' + (index + 1),node('span','cs-rich-swatch-fill'),() => { command(value); closePopup(); },'cs-rich-swatch');
      control.style.setProperty('--cs-swatch',value); control.setAttribute('aria-pressed','false'); control.dataset.color = value;
      swatches.push({control,value,attribute}); controls.append(control);
    });
    controls.append(button('Fjern ' + label.toLocaleLowerCase('da-DK'),'Ingen',() => { command(null); closePopup(); },'cs-rich-text-button'));
    controls.append(button('Luk farvevalg',icon('close'),closePopup)); return panel;
  }
  const colorPanel = palette('Tekstfarve',Model.COLORS,value => value ? editor?.chain().focus().setColor(value).run() : editor?.chain().focus().unsetColor().run(),'color');
  const highlightPanel = palette('Fremhævning',Model.HIGHLIGHTS,value => value ? editor?.chain().focus().setBackgroundColor(value).run() : editor?.chain().focus().unsetBackgroundColor().run(),'backgroundColor');
  colorButton.setAttribute('aria-controls',colorPanel.id); highlightButton.setAttribute('aria-controls',highlightPanel.id);
  const linkPanel = popup('Linkadresse'), linkLabel = node('label','cs-rich-link-label','Linkadresse');
  const linkInput = node('input','cs-rich-link-input'); linkInput.id = id + '-url'; linkInput.type = 'text'; linkInput.inputMode = 'url'; linkInput.autocomplete = 'off'; linkInput.placeholder = 'https://eksempel.dk'; linkLabel.htmlFor = linkInput.id;
  const linkError = node('p','cs-rich-link-error'); linkError.hidden = true; linkError.setAttribute('role','alert');
  const linkActions = node('div','cs-rich-link-actions');
  const applyLink = () => {
    const href = safeUrl(linkInput.value);
    if (!href) { linkError.textContent = 'Brug en gyldig http-, https-, mailto- eller tel-adresse.'; linkError.hidden = false; linkInput.focus(); return; }
    editor?.chain().focus().extendMarkRange('link').setLink({href}).run(); closePopup();
  };
  linkActions.append(button('Anvend link','Anvend',applyLink,'cs-rich-text-button'),button('Fjern link','Fjern link',() => { editor?.chain().focus().extendMarkRange('link').unsetLink().run(); closePopup(); },'cs-rich-text-button'),button('Annuller link','Annuller',closePopup,'cs-rich-text-button'));
  linkPanel.append(linkLabel,linkInput,linkError,linkActions); linkButton.setAttribute('aria-controls',linkPanel.id);
  linkInput.addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyLink(); } });
  const editorHost = node('div','cs-rich-editor-host');
  const templateHint = node('p','cs-rich-template-hint','Tjeklister gemmes som tomme skabeloner. Prøv afkrydsning i forhåndsvisningen.');
  templateHint.hidden = true; author.append(toolbar,popups,editorHost,templateHint);
  const previewStatus = node('div','cs-rich-preview-status'), previewCount = node('span','cs-rich-preview-count');
  previewCount.setAttribute('role','status'); previewCount.setAttribute('aria-live','polite');
  const reset = button('Nulstil afkrydsninger','Nulstil',() => renderPreview(),'cs-rich-text-button'); previewStatus.append(previewCount,reset);
  const previewContent = node('div','cs-rich-content cs-rich-preview-content'), previewNotice = node('p','cs-rich-preview-notice','Afkrydsninger i forhåndsvisningen gemmes ikke.');
  preview.append(previewStatus,previewContent,previewNotice); root.append(tabs,author,preview); element.replaceChildren(root);

  function closePopup() {
    if (!openPopup) return;
    const previous = openPopup; previous.panel.hidden = true; previous.trigger.setAttribute('aria-expanded','false'); openPopup = null;
  }
  function togglePopup(panel,trigger) {
    const same = openPopup?.panel === panel; closePopup(); if (same) return;
    panel.hidden = false; trigger.setAttribute('aria-expanded','true'); openPopup = {panel,trigger};
  }
  root.addEventListener('keydown',event => {
    if (event.key === 'Escape' && openPopup) { const trigger = openPopup.trigger; event.preventDefault(); event.stopPropagation(); closePopup(); trigger.focus(); }
    if (event.key === 'Enter' && !event.target.closest('.tiptap') && event.target !== linkInput) event.stopPropagation();
  });
  tabs.addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const nextPreview = event.key === 'End' || event.key === 'ArrowRight' && !previewMode || event.key === 'ArrowLeft' && !previewMode;
    setMode(nextPreview); (nextPreview ? previewTab : editTab).focus();
  });
  toolbar.addEventListener('keydown',event => {
    if (event.defaultPrevented || event.target.matches('select,input[role="combobox"]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const controls = [...toolbar.querySelectorAll('button,select,input[role="combobox"]')]
      .filter(control => !control.disabled && control.tabIndex !== -1 && control.getClientRects().length);
    const index = controls.indexOf(event.target);
    if (index < 0) return; event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length; controls[next]?.focus();
  });
  function updatePreviewCounts() {
    const checks = [...previewContent.querySelectorAll('input[type="checkbox"]')], completed = checks.filter(control => control.checked).length;
    previewCount.textContent = completed + ' af ' + checks.length + (checks.length === 1 ? ' punkt' : ' punkter') + ' afkrydset'; previewStatus.hidden = !checks.length; previewNotice.hidden = !checks.length; reset.disabled = !completed;
  }
  function renderPreview() {
    if (disposed) return;
    Model.render(previewContent,previewDoc,{interactiveTasks:true,onTaskChange:updatePreviewCounts});
    if (!Model.hasContent(previewDoc)) previewContent.append(node('p','cs-rich-empty','Ingen beskrivelse endnu.'));
    updatePreviewCounts();
  }
  function setMode(value) {
    if (disposed) return;
    previewMode = value; closePopup(); author.hidden = value; preview.hidden = !value;
    [editTab,previewTab].forEach((tab,index) => { const selected = value === Boolean(index); tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1; });
    if (value) { previewDoc = Model.normalize(editor?.getJSON()); renderPreview(); }
  }
  function updateToolbar() {
    if (!editor || loading || disposed) return;
    undo.disabled = !editor.can().undo(); redo.disabled = !editor.can().redo();
    const attrs = editor.getAttributes('textStyle'), currentFamily = String(attrs.fontFamily || 'sans-serif').replace(/["']/g,'');
    family.value = families.includes(currentFamily) ? currentFamily : 'sans-serif'; size.value = sizes.includes(attrs.fontSize) ? attrs.fontSize : '14px';
    block.value = editor.isActive('heading',{level:2}) ? 'h2' : editor.isActive('heading',{level:3}) ? 'h3' : 'paragraph';
    colorGlyph.style.setProperty('--cs-selected-color',attrs.color || Model.COLORS[0]);
    actions.forEach(({control,isActive,canRun}) => { if (isActive) control.setAttribute('aria-pressed',String(Boolean(isActive()))); if (canRun) control.disabled = !canRun(); });
    swatches.forEach(({control,value,attribute}) => control.setAttribute('aria-pressed',String(String(attrs[attribute] || '').toLowerCase() === value.toLowerCase())));
    templateHint.hidden = !editor.isActive('taskList') && !editorHost.querySelector('ul[data-type="taskList"]');
  }
  function cacheData() {
    if (!editor || loading || disposed) return;
    const json = editor.getJSON();
    if (JSON.stringify(json) === initialKey) cached = {...original};
    else { const normalized = Model.normalize(json); cached = {note:Model.text(normalized),noteRich:Model.encode(normalized)}; }
    sourceInput.value = cached.note;
    sourceInput.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function setContent(shift = {}) {
    if (disposed) return;
    loading = true; closePopup(); editor?.destroy(); editorHost.replaceChildren();
    original = {note:typeof shift.note === 'string' ? shift.note : '',noteRich:shift.noteRich ?? ''}; cached = {...original}; sourceInput.value = original.note;
    const content = Model.normalize(original.noteRich) || Model.fromText(original.note);
    editor = new Editor({
      element:editorHost,
      injectCSS:false,
      extensions:[
        StarterKit.configure({heading:{levels:[1,2,3]},trailingNode:false,link:{openOnClick:false,autolink:false,linkOnPaste:false,isAllowedUri:url => Boolean(safeUrl(url)),HTMLAttributes:{target:null,rel:'noopener noreferrer'}}}),
        TaskList,TemplateTaskItem.configure({nested:true}),TemplateTasks,TextStyleKit.configure({lineHeight:false}),AllowedTextStyles,
        TextAlign.configure({types:['heading','paragraph']}),Placeholder.configure({placeholder:'Beskriv opgaver, adgang og praktiske instruktioner…'}),
      ],
      content,
      editorProps:{attributes:{class:'cs-rich-content','aria-label':'Beskrivelse','aria-multiline':'true',role:'textbox',spellcheck:'true'},handleDOMEvents:{click(view,event) { if (event.target.closest('a')) { event.preventDefault(); return true; } return false; }}},
      onUpdate:cacheData,
      onTransaction:updateToolbar,
      onSelectionUpdate:updateToolbar,
    });
    initialKey = JSON.stringify(editor.getJSON()); loading = false; setMode(false); updateToolbar();
  }
  setContent({note:sourceInput.value || ''});
  return {
    setContent,
    getData() { return {...cached}; },
    focus() { if (!disposed) { setMode(false); editor?.commands.focus(); } },
    destroy() { if (disposed) return; disposed = true; closePopup(); editor?.destroy(); element.replaceChildren(); },
  };
}

globalThis.CleanRoomsRichEditor = Object.freeze({mount});
