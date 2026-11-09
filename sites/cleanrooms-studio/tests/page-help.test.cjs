const test=require('node:test'),assert=require('node:assert/strict'),Help=require('../src/page-help.js');
function fixture(){
  class Element{
    constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.attributes={};this.events={};this.hidden=false;this.open=false;this._text='';}
    set textContent(value){this._text=String(value);this.replaceChildren();}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    get isConnected(){return this===this.ownerDocument.body||Boolean(this.parentElement?.isConnected);}
    append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}}
    replaceChildren(...items){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...items);}
    setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
    addEventListener(name,handler){(this.events[name]??=[]).push(handler);}focus(){this.ownerDocument.activeElement=this;}
    showModal(){this.open=true;this.modalCalls=(this.modalCalls||0)+1;}close(){this.open=false;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
    fire(name,event={}){for(const handler of this.events[name]||[])handler({preventDefault(){},stopPropagation(){},target:this,...event});}
  }
  const doc={activeElement:null,createElement(tag){return new Element(tag,doc);}};doc.body=doc.createElement('body');const host=doc.createElement('div'),trigger=doc.createElement('button');doc.body.append(host,trigger);const controller=Help.mount({element:host}),dialog=host.children[0],close=dialog.children[0].children[1];return {doc,host,trigger,controller,dialog,close};
}
test('every app page has concrete guidance and payroll contexts retain their own reading order',()=>{
  for(const page of ['schedule','series','people','hours','leave','activity','workspace','accounts','demo','employee']){const model=Help.content({page});assert.equal(model.key,page);assert.ok(model.steps.length>=3&&model.steps.length<=6);assert.equal(new Set(model.steps.map(([title])=>title)).size,model.steps.length);for(const [title,description]of model.steps){assert.ok(title.trim());assert.ok(description.trim());}}
  const profile=Help.content({page:'people',context:'profile'});assert.equal(profile.title,'Medarbejderprofil');
  const personal=Help.content({page:'people',context:'payroll-person'});assert.equal(personal.title,'Medarbejderens løn og tillæg');assert.match(personal.steps[0][0],/Aktuel lønaftale/);assert.equal(Help.content({page:'payroll',context:'payroll-group'}).title,'Løngruppe');
});
test('page help uses native modality, contains keyboard focus and returns focus on Escape',()=>{
  const app=fixture();app.controller.render({page:'hours'});app.trigger.focus();app.controller.open(app.trigger);assert.equal(app.dialog.open,true);assert.equal(app.dialog.modalCalls,1);assert.equal(app.dialog.hidden,false);assert.equal(app.doc.activeElement,app.close);assert.equal(app.trigger.getAttribute('aria-expanded'),'true');assert.match(app.dialog.textContent,/Tider og pause/);
  let trapped=false;app.dialog.fire('keydown',{key:'Tab',shiftKey:true,preventDefault(){trapped=true;}});assert.equal(trapped,true);assert.equal(app.doc.activeElement,app.close);
  app.dialog.fire('keydown',{key:'Escape'});assert.equal(app.dialog.hidden,true);assert.equal(app.dialog.open,false);assert.equal(app.doc.activeElement,app.trigger);assert.equal(app.trigger.getAttribute('aria-expanded'),'false');
});
test('navigation and permission changes close help without stealing the next page focus',()=>{
  const app=fixture(),viewer={userId:'admin',permissions:['plan']};app.controller.render({page:'schedule',viewer,capabilities:{plan:true}});app.controller.open(app.trigger);app.controller.render({page:'leave',viewer,capabilities:{plan:true}});assert.equal(app.dialog.hidden,true);
  app.controller.open(app.trigger);assert.match(app.dialog.textContent,/Afventer viser/);app.controller.render({page:'leave',viewer:{userId:'employee'},capabilities:{plan:false}});assert.equal(app.dialog.hidden,true);assert.equal(app.doc.activeElement,app.close);app.controller.destroy();assert.equal(app.host.children.length,0);app.controller.open(app.trigger);assert.equal(app.host.children.length,0);
});
test('account guidance reads current server labels when opened and never retains previous access',()=>{
  const app=fixture();let access={roleName:'Teamleder',permissions:[{key:'departments.manage',label:'Afdelinger for teamet'}]};app.controller.render({page:'accounts',viewer:{userId:'a'},getAccountHelp:()=>access});app.controller.open(app.trigger);assert.match(app.dialog.textContent,/Afdelinger for teamet/);assert.match(app.dialog.textContent,/Teamleder/);app.controller.close();access={roleName:'Brugeransvarlig',permissions:[{key:'users.manage',label:'Brugerstyring'}]};app.controller.open(app.trigger);assert.match(app.dialog.textContent,/Brugerstyring/);assert.equal(app.dialog.textContent.includes('Afdelinger for teamet'),false);
  app.controller.close();app.controller.render({page:'hours',viewer:{userId:'a'}});app.controller.open(app.trigger);assert.equal(app.dialog.textContent.includes('Dine rettigheder'),false);
});
