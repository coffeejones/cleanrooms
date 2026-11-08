/* Completion belongs to an assigned occurrence; rich descriptions stay templates. */
(() => {
  'use strict';

  const Description = globalThis.CleanRoomsDescription || (typeof require === 'function' ? require('./description-model.js') : null);
  const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const id = value => typeof value === 'string' && value.trim() !== '';
  const taskPath = value => typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/.test(value);
  const occurrenceKey = (shiftId,person) => JSON.stringify([shiftId,person]);
  const assigned = shift => record(shift) && id(shift.id) && id(shift.person);

  // A parent's completion does not depend on the wording of nested tasks.
  // Their own descriptors and the captured list signature guard those edits.
  function ownTask(node) {
    if (node.type === 'taskList') return {type:'taskList'};
    return {...node,...(node.content ? {content:node.content.map(ownTask)} : {})};
  }

  function taskText(node) {
    if (node.type === 'text') return node.text;
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'taskList') return '';
    return (node.content || []).map(taskText).join(['paragraph','heading','codeBlock'].includes(node.type) ? '' : '\n');
  }

  function catalog(raw) {
    if (raw == null || raw === '') return {valid:true,tasks:[],signature:'[]',structure:'[]'};
    const doc = Description?.normalize(raw);
    if (!doc) return {valid:false,tasks:[],signature:'',structure:''};
    const tasks = [];
    function visit(node,path) {
      if (node.type === 'taskItem') {
        const key = path.join('.');
        tasks.push({key,path:key,text:taskText(node).trim(),signature:JSON.stringify(ownTask(node))});
      }
      (node.content || []).forEach((child,index) => visit(child,[...path,index]));
    }
    (doc.content || []).forEach((node,index) => visit(node,[index]));
    return {valid:true,tasks,signature:JSON.stringify(tasks.map(task => [task.key,task.signature])),structure:JSON.stringify(tasks.map(task => task.key))};
  }

  function tasks(raw) { return catalog(raw).tasks; }

  function storedEntry(value,key) {
    if (!record(value) || value.version !== 1 || !id(value.shiftId) || !id(value.person)
      || key !== occurrenceKey(value.shiftId,value.person) || !record(value.checked) || typeof value.structure !== 'string') return null;
    let paths;
    try { paths = JSON.parse(value.structure); } catch { return null; }
    if (!Array.isArray(paths) || !paths.every(taskPath) || new Set(paths).size !== paths.length) return null;
    const allowed = new Set(paths);
    const checked = Object.fromEntries(Object.entries(value.checked).filter(([path,signature]) => allowed.has(path) && typeof signature === 'string' && signature !== ''));
    if (!Object.keys(checked).length) return null;
    return {version:1,shiftId:value.shiftId,person:value.person,structure:JSON.stringify(paths),checked};
  }

  function sanitize(progress) {
    if (!record(progress)) return {};
    return Object.fromEntries(Object.entries(progress).flatMap(([key,value]) => {
      const entry = storedEntry(value,key); return entry ? [[key,entry]] : [];
    }));
  }

  function read(progress,shift) {
    const empty = reason => ({valid:false,reason,signature:'',tasks:[],checked:0,total:0,complete:false});
    if (!assigned(shift)) return empty('Vælg en vagt, der er tildelt en medarbejder.');
    if (shift.noteRich != null && typeof shift.noteRich !== 'string') return empty('Vagtens tjekliste er ugyldig.');
    const current = catalog(shift.noteRich);
    if (!current.valid) return empty('Vagtens tjekliste er ugyldig.');
    const key = occurrenceKey(shift.id,shift.person),entry = record(progress) ? storedEntry(progress[key],key) : null;
    const saved = entry?.structure === current.structure ? entry.checked : {};
    const tasks = current.tasks.map(task => ({...task,checked:saved[task.key] === task.signature}));
    const checked = tasks.reduce((count,task) => count + Number(task.checked),0);
    return {valid:true,reason:'',signature:current.signature,tasks,checked,total:tasks.length,complete:tasks.length > 0 && checked === tasks.length};
  }

  function reconciledEntry(shift,view) {
    const checked = Object.fromEntries(view.tasks.filter(task => task.checked).map(task => [task.key,task.signature]));
    if (!Object.keys(checked).length) return null;
    return {version:1,shiftId:shift.id,person:shift.person,structure:JSON.stringify(view.tasks.map(task => task.key)),checked};
  }

  // Only explicitly supplied occurrences and deleted IDs are reconciled.
  // A visible-week list must never erase completion belonging to unseen weeks.
  function reconcile(progress,currentShifts,options = {}) {
    const next = sanitize(progress);
    const deleted = new Set(Array.isArray(options?.deletedIds) ? options.deletedIds : []);
    const current = new Map((Array.isArray(currentShifts) ? currentShifts : []).filter(shift => record(shift) && id(shift.id)).map(shift => [shift.id,shift]));
    for (const [key,entry] of Object.entries(next)) {
      if (deleted.has(entry.shiftId)) { delete next[key]; continue; }
      if (!current.has(entry.shiftId)) continue;
      const shift = current.get(entry.shiftId);
      if (!assigned(shift) || shift.person !== entry.person) { delete next[key]; continue; }
      const view = read(next,shift),retained = view.valid ? reconciledEntry(shift,view) : null;
      if (retained) next[key] = retained; else delete next[key];
    }
    return next;
  }

  function set(progress,shift,options = {}) {
    const view = read(progress,shift),input = record(options) ? options : {};
    const blocked = reason => ({ok:false,reason,changed:false,progress:sanitize(progress),view});
    if (!view.valid) return blocked(view.reason);
    if (input.person !== shift.person) return blocked('Vagten er tildelt en anden medarbejder. Åbn den igen.');
    if (input.signature !== view.signature) return blocked('Tjeklisten er ændret. Åbn vagten igen.');
    const task = view.tasks.find(task => task.key === input.key);
    if (!task || typeof input.checked !== 'boolean') return blocked('Vælg en gyldig opgave på tjeklisten.');
    const next = reconcile(progress,[shift]),key = occurrenceKey(shift.id,shift.person);
    const updated = {...view,tasks:view.tasks.map(item => item.key === task.key ? {...item,checked:input.checked} : item)};
    const entry = reconciledEntry(shift,updated);
    if (entry) next[key] = entry; else delete next[key];
    return {ok:true,reason:'',changed:task.checked !== input.checked,progress:next,view:read(next,shift)};
  }

  const api = Object.freeze({tasks,read,set,sanitize,reconcile});
  globalThis.CleanRoomsChecklist = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
