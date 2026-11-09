const test=require('node:test');
const assert=require('node:assert/strict');
const Chat=require('../src/chat-view.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const walk=element=>[element,...element.children.flatMap(walk)];
const byClass=(element,name)=>walk(element).filter(item=>item.className.split(' ').includes(name));
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.className='';this.attributes={};this.dataset={};this.handlers={};this.value='';this.hidden=false;this.disabled=false;this._text='';this.scrollTop=0;this.clientHeight=300;}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this._text='';this.children=[...items];}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(item=>item.textContent).join('');}
 set innerHTML(value){throw Error('Chat content must never use HTML interpolation.');}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,callback){(this.handlers[type]??=[]).push(callback);}
 fire(type,event={}){for(const callback of this.handlers[type]||[])callback({target:this,currentTarget:this,preventDefault(){},...event});}
 click(){if(!this.disabled)this.fire('click');}
 focus(){this.ownerDocument.activeElement=this;}
 get scrollHeight(){return Math.max(300,byClass(this,'cs-chat-message').length*120+200);}
 getClientRects(){if(this.className==='cs-chat-thread'&&this.ownerDocument.mobile){const root=this.ownerDocument.root.children[0];if(root?.dataset.threadOpen!=='true')return [];}return [{}];}
}
function fixture({manager=true,preview=false,mobile=false,totalUnread,roomPages}={}){
 const intervals=new Map();let timerId=0,clock=0;const doc={visibilityState:'visible',mobile,activeElement:null,events:{},defaultView:{Date:{now:()=>clock},setInterval:fn=>{intervals.set(++timerId,fn);return timerId;},clearInterval:id=>intervals.delete(id),events:{},addEventListener(type,fn){(this.events[type]??=[]).push(fn);},removeEventListener(type,fn){this.events[type]=(this.events[type]||[]).filter(item=>item!==fn);},emit(type){for(const fn of this.events[type]||[])fn();}},addEventListener(type,fn){(this.events[type]??=[]).push(fn);},removeEventListener(type,fn){this.events[type]=(this.events[type]||[]).filter(item=>item!==fn);},emit(type){for(const fn of this.events[type]||[])fn();}};
 doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_ns,tag)=>new Element(tag,doc);const host=new Element('div',doc);doc.root=host;
 const room=(id,name)=>({id,departmentId:'dep-'+id,departmentName:name,name,memberCount:7,version:1,latestSeq:2,unread:2,muted:false,lastMessage:{id:id+'-2',seq:2,text:'Der er fyldt op.',authorName:'Mikkel Jensen',createdAt:'2026-11-04T09:05:00Z'}});
 const room1=room('room-1','Kontor Nord'),room2=room('room-2','Klinikken');let rooms=[room1,room2],accessKey='1:admin:1:1:',pins=[{id:'room-1-1',seq:1,text:'Nøglen ligger ved receptionen.',authorId:'colleague',authorName:'Sara Ahmed',createdAt:'2026-11-04T09:00:00Z',pinned:true}];
 const messages=new Map(rooms.map(item=>[item.id,[{id:item.id+'-1',seq:1,text:'Nøglen ligger ved receptionen.',authorId:'colleague',authorName:'Sara Ahmed',createdAt:'2026-11-04T09:00:00Z',pinned:item.id==='room-1'},{id:item.id+'-2',seq:2,text:'Der er fyldt op.',authorId:'other',authorName:'Mikkel Jensen',createdAt:'2026-11-04T09:05:00Z'}]]));
 const calls=[],unread=[];let hook=null;
 async function defaultAction(action,payload){
  const current=rooms.find(item=>item.id===payload.roomId);
  if(action==='chatList'){const page=roomPages?payload.cursor?roomPages[1]:roomPages[0]:rooms;return {rooms:clone(page),departments:rooms.map(item=>({id:item.departmentId,name:item.departmentName,memberCount:item.memberCount,hasRoom:true})).concat([{id:'dep-new',name:'Havnegade',memberCount:5,hasRoom:false}]),readonly:preview,canManage:manager,unreadCount:totalUnread??rooms.reduce((sum,item)=>sum+(item.muted?0:item.unread),0),nextCursor:roomPages&&!payload.cursor?'page-2':null,accessKey};}
  if(action==='chatRead'){return {room:clone(current),messages:clone(messages.get(payload.roomId)||[]),pins:payload.roomId==='room-1'?clone(pins):[],nextCursor:payload.before?null:'older',hasMore:!payload.before,accessKey};}
  if(action==='chatSync'){const values=(messages.get(payload.roomId)||[]).filter(item=>item.seq>payload.afterSeq).sort((a,b)=>a.seq-b.seq),page=values.slice(0,payload.limit||50),latestSeq=Math.max(0,...(messages.get(payload.roomId)||[]).map(item=>item.seq)),throughSeq=page.at(-1)?.seq??payload.afterSeq,version=current.version,unchanged=!page.length&&payload.version===version;return {unchanged,latestSeq,version,throughSeq,hasMoreNew:throughSeq<latestSeq,...(!unchanged?{room:clone(current),messages:clone(page),...(payload.version!==version?{pins:payload.roomId==='room-1'?clone(pins):[]}:{})}:{}),accessKey};}
  if(action==='chatReadMark'){current.unread=0;return {room:clone(current),accessKey};}
  if(action==='chatMute'){current.muted=payload.muted;return {room:clone(current),accessKey};}
  if(action==='chatSend'){const values=messages.get(payload.roomId),message={id:payload.clientId,seq:values.at(-1).seq+1,text:payload.text,authorId:'viewer',authorName:'Jonas Hansen',createdAt:'2026-11-04T10:00:00Z'};values.push(message);current.latestSeq=message.seq;current.lastMessage=message;return {room:clone(current),message:clone(message),accessKey};}
  if(action==='chatPin'){pins=payload.pinned?[messages.get(payload.roomId).find(item=>item.id===payload.messageId)]:[];current.version++;return {room:clone(current),accessKey};}
  if(action==='chatCreate'){const next=room('room-new',payload.name);next.departmentId=payload.departmentId;rooms.push(next);messages.set(next.id,[]);return {room:clone(next),accessKey};}
  if(action==='chatUpdate'){current.name=payload.name;current.version++;return {room:clone(current),accessKey};}
  if(action==='chatDemo')return {rooms:clone(rooms),accessKey};
  throw Error('Unexpected action '+action);
 }
 const controller=Chat.mount({element:host,onAction:async(action,payload)=>{calls.push({action,payload:clone(payload)});return hook?hook(action,payload,defaultAction):defaultAction(action,payload);},onUnread:count=>unread.push(count)});
 controller.render({viewer:{userId:'viewer',name:'Jonas Hansen'},capabilities:{manageChat:manager},active:true,workspaceId:'workspace-1'});
 return {host,doc,controller,calls,unread,intervals,messages,room1,room2,rooms,element:name=>byClass(host,name)[0],elements:name=>byClass(host,name),hook:fn=>{hook=fn;},access:key=>{accessKey=key;},button:label=>walk(host).find(item=>item.tagName==='button'&&(item.textContent===label||item.getAttribute('aria-label')===label)),roomButton:id=>byClass(host,'cs-chat-room').find(item=>item.dataset.roomId===id),async tick(ms=1000){clock+=ms;for(const fn of intervals.values())fn();await settle();}};
}

test('department chat renders trusted identities and literal untrusted messages while using server-wide unread totals',async()=>{
 const app=fixture({totalUnread:121});await settle();assert.equal(app.calls.filter(call=>call.action==='chatRead').length,1,'Initial room selection needs one message read.');assert.equal(app.unread[0],121);assert.ok(app.unread.at(-1)>=119,'Only locally marked reads are subtracted from the server-wide total.');
 assert.match(app.host.textContent,/Kontor Nord/);assert.equal(app.element('cs-chat-message-text').textContent,'Nøglen ligger ved receptionen.');
 const message=app.messages.get('room-1')[0];message.text='<img src=x onerror=alert(1)>\nLinje to';message.authorName='<script>unsafe</script>';await app.controller.refresh();await settle();
 assert.equal(app.element('cs-chat-message-text').textContent,message.text);assert.ok(app.host.textContent.includes('<script>unsafe</script>'));assert.equal(walk(app.host).some(item=>item.tagName==='img'||item.tagName==='script'),false);app.controller.destroy();
});

test('room drafts and focused composer survive polling and switching conversations',async()=>{
 const app=fixture();await settle();const input=app.element('cs-chat-compose-input');input.value='Bevar min kladde\nmed en ekstra linje';input.fire('input');input.focus();
 app.messages.get('room-1').push({id:'arrival',seq:3,text:'En ny besked',authorId:'other',authorName:'Mikkel',createdAt:'2026-11-04T10:05:00Z'});await app.tick();
 assert.equal(app.element('cs-chat-compose-input'),input);assert.equal(input.value,'Bevar min kladde\nmed en ekstra linje');assert.equal(app.doc.activeElement,input);
 app.roomButton('room-2').click();await settle();input.value='En anden kladde';input.fire('input');app.roomButton('room-1').click();await settle();assert.equal(input.value,'Bevar min kladde\nmed en ekstra linje');app.controller.destroy();
});

test('unchanged chats adapt to 1, 2, 5 and 10 second checks while focus and new messages restore fast sync',async()=>{
 const app=fixture();await settle();const syncs=()=>app.calls.filter(call=>call.action==='chatSync').length;
 await app.tick();assert.equal(syncs(),1);await app.tick();assert.equal(syncs(),2);await app.tick();assert.equal(syncs(),2);await app.tick();assert.equal(syncs(),3);await app.tick(4000);assert.equal(syncs(),3);await app.tick();assert.equal(syncs(),4);
 await app.tick(9000);assert.equal(syncs(),4);assert.equal(app.calls.filter(call=>call.action==='chatList').length,2,'Catalog freshness has its own deadline even while the thread is idle.');await app.tick();assert.equal(syncs(),5);
 app.doc.defaultView.emit('focus');await settle();assert.equal(syncs(),6,'Returning to the window checks immediately.');app.messages.get('room-1').push({id:'arrival-idle',seq:3,text:'Nyt efter den stille periode',authorId:'other',authorName:'Mikkel',createdAt:'2026-11-04T10:05:00Z'});await app.tick();assert.equal(syncs(),7);assert.match(app.host.textContent,/Nyt efter den stille periode/);await app.tick();assert.equal(syncs(),8,'Receiving a change returns to one-second synchronization.');
 app.controller.destroy();assert.equal(app.doc.defaultView.events.focus.length,0);assert.equal(app.intervals.size,0);
});

test('sending wakes an idle conversation without waiting for its next idle deadline',async()=>{
 const app=fixture();await settle();await app.tick();await app.tick();await app.tick(2000);await app.tick(5000);const before=app.calls.filter(call=>call.action==='chatSync').length;assert.equal(before,4);
 const input=app.element('cs-chat-compose-input');input.value='En besked fra mig';input.fire('input');app.button('Send besked').click();await settle();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,before+1);assert.match(app.host.textContent,/En besked fra mig/);app.controller.destroy();
});

test('simultaneous room refreshes share one pending catalog read',async()=>{
 const app=fixture();await settle();const initial=app.calls.filter(call=>call.action==='chatList').length;let release;
 app.hook((action,payload,normal)=>action==='chatList'?new Promise(resolve=>{release=()=>normal(action,payload).then(resolve);}):normal(action,payload));
 const first=app.controller.load(),second=app.controller.load();await settle();assert.equal(app.calls.filter(call=>call.action==='chatList').length,initial+1);assert.equal(first,second);await release();await Promise.all([first,second]);assert.equal(app.elements('cs-chat-room').length,2);app.controller.destroy();
});

test('retrying a failed send reuses the idempotency key and an acknowledged send never erases newer typing',async()=>{
 const app=fixture();await settle();const input=app.element('cs-chat-compose-input');input.value='Den første besked';input.fire('input');let attempts=0,finish;
 app.hook(async(action,payload,normal)=>{if(action!=='chatSend')return normal(action,payload);attempts++;if(attempts===1)return {ok:false,status:503,message:'Midlertidig netværksfejl'};return new Promise(resolve=>{finish=()=>normal(action,payload).then(resolve);});});
 app.button('Send besked').click();await settle();assert.equal(input.value,'Den første besked');assert.match(app.element('cs-chat-compose-status').textContent,/netværksfejl/);app.button('Send besked').click();await settle();
 const sends=app.calls.filter(call=>call.action==='chatSend');assert.equal(sends.length,2);assert.equal(sends[0].payload.clientId,sends[1].payload.clientId);input.value='Noget nyt jeg skriver';input.fire('input');finish();await settle();
 assert.equal(input.value,'Noget nyt jeg skriver');assert.equal(app.elements('cs-chat-message').filter(item=>item.dataset.messageId===sends[0].payload.clientId).length,1);app.controller.destroy();
});

for(const operation of ['chatRead','chatSend','chatMute','chatPin','older'])test('revoked access clears cached conversation and pins during '+operation,async()=>{
 const app=fixture();await settle();assert.ok(app.host.textContent.includes('Nøglen ligger ved receptionen.'));
 app.hook(async(action,payload,normal)=>action===(operation==='older'?'chatRead':operation)?{ok:false,status:403,message:'Adgangen til rummet er fjernet.'}:normal(action,payload));
 if(operation==='chatRead'){await app.controller.refresh();}else if(operation==='chatSend'){const input=app.element('cs-chat-compose-input');input.value='Et svar';input.fire('input');app.button('Send besked').click();}else if(operation==='chatMute'){app.button('Slå notifikationer fra').click();}else if(operation==='chatPin'){app.button('Fastgør besked').click();}else app.button('Vis ældre beskeder').click();await settle();
 assert.equal(app.elements('cs-chat-message').length,0);assert.equal(app.elements('cs-chat-pin').length,0);assert.equal(app.element('cs-chat-composer').hidden,true);assert.equal(app.host.textContent.includes('Nøglen ligger ved receptionen.'),false);app.controller.destroy();
});

test('employee preview is read-only and mobile room-list auto-selection does not mark hidden messages as read',async()=>{
 const preview=fixture({preview:true});await settle();assert.equal(preview.element('cs-chat-composer').hidden,true);assert.equal(preview.element('cs-chat-preview-note').hidden,false);assert.ok(preview.calls.every(call=>['chatList','chatRead'].includes(call.action)));assert.equal(preview.button('Opret chatrum').hidden,true);preview.controller.destroy();
 const mobile=fixture({mobile:true});await settle();assert.equal(mobile.calls.some(call=>call.action==='chatReadMark'),false);mobile.roomButton('room-1').click();await settle();assert.equal(mobile.calls.some(call=>call.action==='chatReadMark'),true);mobile.controller.destroy();
});

test('paused or hidden chat stops polling and ignores late responses; new identity starts a fresh conversation',async()=>{
 const app=fixture();await settle();assert.equal(app.intervals.size,1);let release;app.hook((action,payload,normal)=>action==='chatRead'?new Promise(resolve=>{release=()=>resolve({room:clone(app.room1),messages:[{id:'late',seq:90,text:'LATE PRIVATE BODY',authorId:'other',authorName:'Peer',createdAt:'2026-11-04T10:00:00Z'}],pins:[],hasMore:false,nextCursor:null,accessKey:'1:admin:1:1:'});}):normal(action,payload));
 const refreshing=app.controller.refresh();await settle();app.controller.setActive(false);release();await refreshing;await settle();assert.equal(app.intervals.size,0);assert.equal(app.host.textContent.includes('LATE PRIVATE BODY'),false);
 app.hook(null);app.doc.visibilityState='hidden';app.controller.setActive(true);await settle();assert.equal(app.intervals.size,0);app.doc.visibilityState='visible';app.doc.emit('visibilitychange');await settle();assert.equal(app.intervals.size,1);
 const input=app.element('cs-chat-compose-input');input.value='Old identity draft';input.fire('input');app.controller.render({viewer:{userId:'new-user'},active:true,workspaceId:'another-workspace'});await settle();assert.equal(input.value,'');assert.ok(app.calls.filter(call=>call.action==='chatList').length>=3);app.controller.destroy();assert.equal(app.intervals.size,0);
});

test('room pagination retains loaded pages during ordinary refresh and resets them after an access generation change',async()=>{
 const one={id:'room-1',departmentId:'dep-1',departmentName:'Nord',name:'Nord',memberCount:5,version:1,unread:1,muted:false},two={id:'room-2',departmentId:'dep-2',departmentName:'Klinik',name:'Klinik',memberCount:5,version:1,unread:1,muted:false};
 const app=fixture({roomPages:[[one],[two]],totalUnread:120});await settle();app.button('Vis flere rum').click();await settle();assert.equal(app.elements('cs-chat-room').length,2);await app.controller.refresh();await settle();assert.equal(app.elements('cs-chat-room').length,2);app.access('1:admin:1:2:');await app.controller.refresh();await settle();assert.equal(app.elements('cs-chat-room').length,1);assert.ok(app.unread.at(-1)>=119);app.controller.destroy();
});

test('manager room creation and pinning use the selected department and authoritative room version',async()=>{
 const app=fixture();await settle();app.button('Opret chatrum').click();const name=walk(app.host).find(item=>item.getAttribute('aria-label')==='Navn på chatrum');name.value='Drift · Havnegade';app.element('cs-chat-dialog-foot').children.at(-1).click();await settle();const create=app.calls.find(call=>call.action==='chatCreate');assert.deepEqual(create.payload,{departmentId:'dep-new',name:'Drift · Havnegade'});
 app.roomButton('room-1').click();await settle();app.button('Fastgør besked').click();await settle();const pin=app.calls.find(call=>call.action==='chatPin');assert.equal(pin.payload.roomId,'room-1');assert.equal(pin.payload.version,1);assert.equal(pin.payload.pinned,true);app.controller.destroy();
});

for(const operation of ['chatCreate','chatDemo'])test('revocation during '+operation+' closes management and clears private content',async()=>{
 const app=fixture();await settle();app.hook(async(action,payload,normal)=>action===operation?{ok:false,status:403,message:'Administrationsretten er fjernet.'}:normal(action,payload));
 if(operation==='chatCreate'){app.button('Opret chatrum').click();app.element('cs-chat-dialog-foot').children.at(-1).click();}else app.button('Tilføj eksempelrum').click();await settle();
 assert.equal(app.elements('cs-chat-message').length,0);assert.equal(app.element('cs-chat-modal-layer').hidden,true);assert.equal(app.element('cs-chat-composer').hidden,true);app.controller.destroy();
});

test('an explicit late access-generation conflict clears the conversation while ordinary room-version conflicts keep the draft',async()=>{
 const app=fixture();await settle();const input=app.element('cs-chat-compose-input');input.value='En usendt besked';input.fire('input');
 app.hook(async(action,payload,normal)=>action==='chatSend'?{ok:false,status:409,error:'chat_room_changed',message:'Rummet er opdateret.'}:normal(action,payload));app.button('Send besked').click();await settle();assert.equal(input.value,'En usendt besked');assert.ok(app.elements('cs-chat-message').length>0);
 app.hook(async(action,payload,normal)=>action==='chatSend'?{ok:false,status:409,error:'chat_access_changed',message:'Afdelingstilknytningen er ændret.'}:normal(action,payload));app.button('Send besked').click();await settle();assert.equal(app.elements('cs-chat-message').length,0);assert.equal(app.elements('cs-chat-pin').length,0);assert.equal(app.element('cs-chat-composer').hidden,true);app.controller.destroy();
});

test('an empty read-only conversation never invites the previewed employee to write',async()=>{
 const app=fixture({preview:true});app.messages.set('room-1',[]);await settle();assert.equal(app.element('cs-chat-feed-empty').hidden,false);assert.equal(app.element('cs-chat-feed-empty').textContent,'Ingen beskeder i dette chatrum endnu.');assert.equal(app.element('cs-chat-composer').hidden,true);app.controller.destroy();
});

test('an unchanged conversation refresh preserves expanded pins, their DOM identity and both scroll positions',async()=>{
 const app=fixture();await settle();const pin=app.element('cs-chat-pin'),pinned=app.element('cs-chat-pinned'),feed=app.element('cs-chat-feed');pin.open=true;pinned.scrollTop=27;feed.scrollTop=100;
 await app.controller.refresh();await settle();
 assert.equal(app.element('cs-chat-pin'),pin,'Unchanged pins must retain their existing details nodes.');assert.equal(pin.open,true);assert.equal(pinned.scrollTop,27);assert.equal(feed.scrollTop,100,'Polling with no new messages must not snap a reader who is close to the bottom.');app.controller.destroy();
});

test('a delayed conversation response does not drag a reader back down after they scroll up',async()=>{
 const app=fixture();await settle();const feed=app.element('cs-chat-feed');feed.scrollTop=feed.scrollHeight-feed.clientHeight;let release;
 app.hook((action,payload,normal)=>action==='chatRead'?new Promise(resolve=>{release=()=>normal(action,payload).then(resolve);}):normal(action,payload));
 const refreshing=app.controller.refresh();await settle();assert.equal(typeof release,'function','The message read is pending while the reader moves.');feed.scrollTop=0;
 app.messages.get('room-1').push({id:'late-arrival',seq:3,text:'En besked mens jeg læser længere oppe.',authorId:'other',authorName:'Mikkel',createdAt:'2026-11-04T10:05:00Z'});await release();await refreshing;await settle();
 assert.equal(app.elements('cs-chat-message').length,3);assert.equal(feed.scrollTop,0,'Use the current reader position, not the position captured before the server call.');assert.equal(app.element('cs-chat-new-messages').hidden,false);app.controller.destroy();
});

test('a changed pin list preserves expanded state for surviving messages and the pin panel scroll position',async()=>{
 const app=fixture();await settle();const pin=app.element('cs-chat-pin'),pinned=app.element('cs-chat-pinned');pin.open=true;pinned.scrollTop=19;
 app.hook(async(action,payload,normal)=>{const result=await normal(action,payload);if(action==='chatRead'){result.pins[0].text='Nøglen ligger nu i det markerede skab.';result.pins.push({...result.messages[1],pinned:true});}return result;});
 await app.controller.refresh();await settle();
 const current=app.elements('cs-chat-pin');assert.equal(current.length,2);assert.equal(current[0].open,true,'A retained pin stays expanded even when its text or the surrounding pin list changes.');assert.match(current[0].textContent,/markerede skab/);assert.equal(pinned.scrollTop,19);app.controller.destroy();
});

test('fast sync is silent, does not overlap, and refreshes the room catalog less often than messages',async()=>{
 const app=fixture();await settle();const room=app.roomButton('room-1'),pin=app.element('cs-chat-pin'),feed=app.element('cs-chat-feed');feed.scrollTop=100;let release;
 app.hook((action,payload,normal)=>action==='chatSync'?new Promise(resolve=>{release=()=>normal(action,payload).then(resolve);}):normal(action,payload));
 await app.tick();assert.equal(typeof release,'function');assert.equal(app.element('cs-chat-list-status').hidden,true);assert.equal(app.element('cs-chat-thread-status').hidden,true);assert.equal(app.roomButton('room-1'),room);
 await app.tick();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,1,'A pending sync must not start a second request.');await release();await settle();assert.equal(app.element('cs-chat-pin'),pin);assert.equal(feed.scrollTop,100);
 app.hook(null);await app.tick(14000);assert.equal(app.calls.filter(call=>call.action==='chatList').length,2);assert.equal(app.calls.filter(call=>call.action==='chatRead').length,1,'Catalog refresh does not refetch the message history.');assert.equal(app.element('cs-chat-list-status').hidden,true);assert.equal(app.element('cs-chat-thread-status').hidden,true);app.controller.destroy();
});

test('bounded fast-sync pages drain a burst without losing messages between the initial page and later ticks',async()=>{
 const app=fixture();await settle();for(let seq=3;seq<=235;seq++)app.messages.get('room-1').push({id:'burst-'+seq,seq,text:'Besked '+seq,authorId:'peer',authorName:'Sara',createdAt:'2026-11-04T10:00:00Z'});
 await app.tick();await settle();assert.equal(app.elements('cs-chat-message').length,202,'At most four 50-message pages are drained in one tick.');await app.tick();await settle();
 assert.deepEqual(app.elements('cs-chat-message').map(item=>item.dataset.messageId),['room-1-1','room-1-2',...Array.from({length:233},(_,i)=>'burst-'+(i+3))]);assert.deepEqual(app.calls.filter(call=>call.action==='chatSync').map(call=>call.payload.afterSeq),[2,52,102,152,202]);assert.ok(app.calls.filter(call=>call.action==='chatReadMark').every(call=>call.payload.throughSeq<=235));app.controller.destroy();
});

test('an own send acknowledgement cannot skip or mark unseen peer messages read',async()=>{
 const app=fixture();await settle();app.messages.get('room-1').push({id:'peer-before-own',seq:3,text:'Sendt lige før dit svar',authorId:'peer',authorName:'Sara',createdAt:'2026-11-04T10:00:00Z'});let release;
 app.hook((action,payload,normal)=>action==='chatSync'?new Promise(resolve=>{release=()=>normal(action,payload).then(resolve);}):normal(action,payload));const input=app.element('cs-chat-compose-input');input.value='Mit hurtige svar';input.fire('input');app.button('Send besked').click();await settle();
 assert.ok(app.host.textContent.includes('Mit hurtige svar'),'The acknowledged own message appears immediately.');assert.equal(app.host.textContent.includes('Sendt lige før dit svar'),false);assert.equal(app.calls.filter(call=>call.action==='chatReadMark').at(-1).payload.throughSeq,2,'Own seq4 must not mark unseen peer seq3 as read.');assert.equal(app.calls.filter(call=>call.action==='chatSync').at(-1).payload.afterSeq,2);
 await release();await settle();assert.ok(app.host.textContent.includes('Sendt lige før dit svar'));assert.equal(app.elements('cs-chat-message').length,4);assert.equal(app.calls.filter(call=>call.action==='chatReadMark').at(-1).payload.throughSeq,4);app.controller.destroy();
});

test('a newer room summary from a send does not advance the known pin version before synchronized pin bodies arrive',async()=>{
 const app=fixture();await settle();app.room1.version=2;let requestedVersion;
 app.hook(async(action,payload,normal)=>{const result=await normal(action,payload);if(action==='chatSync'){requestedVersion=payload.version;if(result.pins)result.pins[0].text='Den opdaterede fastgjorte besked';}return result;});
 const input=app.element('cs-chat-compose-input');input.value='Et svar';input.fire('input');app.button('Send besked').click();await settle();assert.equal(requestedVersion,1);assert.match(app.element('cs-chat-pinned').textContent,/Den opdaterede fastgjorte besked/);app.controller.destroy();
});

test('an unchanged sync with a new access generation reloads authorized bodies instead of leaving an empty cached conversation',async()=>{
 const app=fixture();await settle();const reads=app.calls.filter(call=>call.action==='chatRead').length;app.access('1:admin:1:2:');await app.tick();await settle();assert.equal(app.calls.filter(call=>call.action==='chatRead').length,reads+1);assert.equal(app.elements('cs-chat-message').length,2);assert.equal(app.elements('cs-chat-pin').length,1);app.controller.destroy();
});

test('sync errors back off, hidden pages stop checks, and returning to the tab retries immediately',async()=>{
 const app=fixture();await settle();app.hook(async(action,payload,normal)=>action==='chatSync'?{ok:false,status:503,message:'Offline'}:normal(action,payload));await app.tick();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,1);await app.tick();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,1);await app.tick();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,2);await app.tick(3000);assert.equal(app.calls.filter(call=>call.action==='chatSync').length,2);await app.tick();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,3);
 app.doc.visibilityState='hidden';app.doc.emit('visibilitychange');assert.equal(app.intervals.size,0);app.hook(null);await app.tick(500);assert.equal(app.calls.filter(call=>call.action==='chatSync').length,3);app.doc.visibilityState='visible';app.doc.emit('visibilitychange');await settle();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,4);assert.equal(app.element('cs-chat-thread-status').hidden,true);assert.equal(app.intervals.size,1);app.controller.destroy();
});

test('transient metadata races retry quietly while a revoked sync clears all private conversation content',async()=>{
 const app=fixture();await settle();let attempt=0;app.hook(async(action,payload,normal)=>action==='chatSync'&&++attempt===1?{ok:false,status:409,error:'chat_sync_changed',message:'Changed'}:normal(action,payload));await app.tick();assert.equal(app.element('cs-chat-thread-status').hidden,true);assert.equal(app.elements('cs-chat-message').length,2);await app.tick();assert.equal(app.calls.filter(call=>call.action==='chatSync').length,2);
 app.hook(async(action,payload,normal)=>action==='chatSync'?{ok:false,status:403,message:'Adgang fjernet'}:normal(action,payload));await app.tick();assert.equal(app.elements('cs-chat-message').length,0);assert.equal(app.elements('cs-chat-pin').length,0);assert.equal(app.element('cs-chat-composer').hidden,true);app.controller.destroy();
});

test('a version race during the first history read retries once and still initializes the sync cursor from received messages',async()=>{
 const app=fixture();let attempt=0;app.hook(async(action,payload,normal)=>action==='chatRead'&&++attempt===1?{ok:false,status:409,error:'chat_sync_changed',message:'Changed'}:normal(action,payload));await settle();assert.equal(app.calls.filter(call=>call.action==='chatRead').length,2);assert.equal(app.elements('cs-chat-message').length,2);assert.equal(app.element('cs-chat-thread-status').hidden,true);await app.tick();assert.equal(app.calls.find(call=>call.action==='chatSync').payload.afterSeq,2);app.controller.destroy();
});

test('a delayed older-history page cannot replace pins from a newer synchronized metadata version',async()=>{
 const app=fixture();await settle();let releaseSync,releaseOlder;
 app.hook(async(action,payload,normal)=>{
  if(action==='chatSync')return new Promise(resolve=>{releaseSync=async()=>{const result=await normal(action,payload);result.pins[0].text='Den nye fastgjorte instruktion';resolve(result);};});
  if(action==='chatRead'&&payload.before){const captured=await normal(action,payload);return new Promise(resolve=>{releaseOlder=()=>resolve(captured);});}
  return normal(action,payload);
 });
 await app.tick();app.button('Vis ældre beskeder').click();await settle();assert.equal(typeof releaseOlder,'function');app.room1.version=2;await releaseSync();await settle();assert.match(app.element('cs-chat-pinned').textContent,/Den nye fastgjorte instruktion/);
 releaseOlder();await settle();assert.match(app.element('cs-chat-pinned').textContent,/Den nye fastgjorte instruktion/,'A valid but older history response must not regress already synchronized pins.');app.controller.destroy();
});
