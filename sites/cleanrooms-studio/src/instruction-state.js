/* Read-model instruction tokens compare display state; they never authorize writes. */
(() => {
  'use strict';
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const valid=value=>record(value)&&Object.keys(value).every(key=>['token','hasDescription'].includes(key))&&/^i1-[a-f0-9]{16}$/.test(value.token)&&typeof value.hasDescription==='boolean';
  const isDeferred=value=>record(value)&&Object.hasOwn(value,'_instructions');
  function signature(value){
    if(isDeferred(value)){if(!valid(value._instructions)||Object.hasOwn(value,'note')||Object.hasOwn(value,'noteRich'))throw new TypeError('Vagtens instruktioner er ikke indlæst sikkert.');return value._instructions.token;}
    const text=JSON.stringify([value?.note??'',value?.noteRich??'']);let first=2166136261,second=2246822519;
    for(let index=0;index<text.length;index++){const code=text.charCodeAt(index);first=Math.imul(first^code,16777619);second=Math.imul(second^code,3266489917);}
    return 'i1-'+(first>>>0).toString(16).padStart(8,'0')+(second>>>0).toString(16).padStart(8,'0');
  }
  function metadata(value){const token=signature(value);return {token,hasDescription:isDeferred(value)?value._instructions.hasDescription:Boolean(typeof value?.note==='string'&&value.note.trim()||value?.noteRich)};}
  const equal=(one,two)=>signature(one)===signature(two);
  const contains=value=>Array.isArray(value)?value.some(contains):record(value)&&(isDeferred(value)||Object.values(value).some(contains));
  const api=Object.freeze({valid,isDeferred,signature,metadata,equal,contains});globalThis.CleanRoomsInstructions=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
