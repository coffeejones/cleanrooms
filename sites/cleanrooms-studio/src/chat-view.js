/* Department conversations keep their own drafts and bounded, authorized pages. */
(() => {
  'use strict';
  const list=value=>Array.isArray(value)?value:[];
  const text=value=>typeof value==='string'?value:'';
  const MAX_TEXT=10000;
  const initials=name=>String(name||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase('da-DK')||'–';
  const stamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date:null;};
  const clock=value=>stamp(value)?.toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'})||'';
  const dateLabel=value=>stamp(value)?.toLocaleDateString('da-DK',{weekday:'long',day:'numeric',month:'long',year:'numeric'})||'Beskeder';
  const dayKey=value=>{const date=stamp(value);return date?[date.getFullYear(),date.getMonth(),date.getDate()].join('-'):'unknown';};
  const sequence=message=>Number.isSafeInteger(message?.seq)?message.seq:0;
  const sortMessages=messages=>[...new Map(list(messages).filter(message=>message&&typeof message.id==='string').map(message=>[message.id,message])).values()].sort((a,b)=>sequence(a)-sequence(b)||String(a.id).localeCompare(String(b.id)));
  function mount({element,onAction,viewer:initialViewer,onUnread=()=>{},onHelp}={}){
    if(!element?.ownerDocument)throw new TypeError('Chat kræver et indholdsfelt.');
    const doc=element.ownerDocument,win=doc.defaultView||globalThis;
    const node=(tag,cls,value)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
    const button=(label,handler,cls='cs-button cs-chat-button')=>{const el=node('button',cls,label);el.type='button';el.addEventListener('click',()=>{if(!el.disabled&&!disposed)handler();});return el;};
    const root=node('section','cs-chat-workspace');root.setAttribute('aria-label','Afdelingschat');element.replaceChildren(root);
    let options={viewer:initialViewer||{}},identity='',epoch=0,roomEpoch=0,disposed=false,active=false,timer=null,loaded=false,readonly=false,canManage=false;
    let rooms=[],departments=[],listCursor=null,selected=null,messages=[],pins=[],messageCursor=null,hasMore=false,listPending=false,threadPending=false,olderPending=false;
    let accessKey='',accessEpoch=0,unreadRemainder=0;
    let syncedThrough=null,syncedVersion=null,syncPending=false,syncRequest=0,syncFailures=0,nextSyncAt=0,syncError='',lastCatalogAt=-Infinity,listSilent=false,threadSilent=false,idleRound=0,nextIdleSyncAt=0,catalogPromise=null;
    const now=()=> (win.Date||Date).now();
    let listRequest=0,threadRequest=0,lastFeedSignature='',lastPinSignature='',lastRoomSignature='',listError='',threadError='',statusText='',newCount=0,marking=false;
    const drafts=new Map(),pendingSends=new Map(),lastMarked=new Map();
    let sendingRoom=null,modalState=null,modalTrigger=null,mutationBusy=false;
    const sidebar=node('aside','cs-chat-sidebar');sidebar.setAttribute('aria-label','Chatrum');
    const sideHead=node('div','cs-chat-sidebar-head'),sideTitle=node('h2','','Afdelinger');
    const createButton=button('+',()=>openRoomModal(),'cs-chat-icon-button');createButton.setAttribute('aria-label','Opret chatrum');createButton.title='Opret chatrum';sideHead.append(sideTitle,createButton);
    const listStatus=node('p','cs-chat-list-status');listStatus.hidden=true;listStatus.setAttribute('role','status');
    const roomList=node('div','cs-chat-room-list');roomList.setAttribute('aria-label','Dine chatrum');
    const moreRooms=button('Vis flere rum',()=>loadRooms(true),'cs-button cs-chat-more-rooms');moreRooms.hidden=true;
    const sideFoot=node('div','cs-chat-sidebar-foot'),demoButton=button('Tilføj eksempelrum',seedDemo,'cs-chat-text-button');
    const affiliation=node('p','cs-chat-affiliation','Adgang følger afdelingens faste arbejdssteder.');sideFoot.append(affiliation,demoButton);sideHead.append(listStatus);sidebar.append(sideHead,roomList,moreRooms,sideFoot);
    const thread=node('section','cs-chat-thread');thread.setAttribute('aria-label','Samtale');
    const empty=node('div','cs-chat-empty'),emptyMark=node('div','cs-chat-empty-mark','#'),emptyTitle=node('h3','','Et sted til det daglige'),emptyCopy=node('p','','Vælg en afdeling for at læse og skrive med dine kolleger.');emptyMark.setAttribute('aria-hidden','true');empty.append(emptyMark,emptyTitle,emptyCopy);
    const body=node('div','cs-chat-thread-body');body.hidden=true;
    const head=node('header','cs-chat-thread-head'),back=button('‹ Rum',()=>showRooms(),'cs-chat-back cs-chat-text-button'),headCopy=node('div','cs-chat-thread-identity'),roomTitle=node('h2'),roomMeta=node('p'),headActions=node('div','cs-chat-head-actions');headCopy.append(roomTitle,roomMeta);
    const mute=button('',toggleMute,'cs-chat-icon-button'),settings=button('⋯',()=>openRoomModal(currentRoom()),'cs-chat-icon-button');settings.setAttribute('aria-label','Rediger chatrum');settings.title='Rediger chatrum';headActions.append(mute,settings);if(typeof onHelp==='function'){const help=button('?',()=>onHelp(),'cs-chat-icon-button');help.setAttribute('aria-label','Hjælp til chat');headActions.append(help);}head.append(back,headCopy,headActions);
    const preview=node('p','cs-chat-preview-note','Forhåndsvisning · Du kan læse samtalen, men ikke skrive på en medarbejders vegne.');preview.hidden=true;
    const pinned=node('section','cs-chat-pinned');pinned.setAttribute('aria-label','Fastgjorte beskeder');pinned.hidden=true;
    const threadStatus=node('div','cs-chat-thread-status');threadStatus.hidden=true;threadStatus.setAttribute('role','status');
    const retry=button('Prøv igen',()=>loadThread(selected),'cs-button cs-chat-retry');retry.hidden=true;
    const scroller=node('div','cs-chat-feed');scroller.tabIndex=0;scroller.setAttribute('aria-label','Beskeder i samtalen');
    const older=button('Vis ældre beskeder',loadOlder,'cs-chat-older cs-chat-text-button');older.hidden=true;
    const feed=node('div','cs-chat-message-list');feed.setAttribute('role','log');feed.setAttribute('aria-live','polite');feed.setAttribute('aria-relevant','additions');
    const feedEmpty=node('p','cs-chat-feed-empty','Ingen beskeder endnu. Skriv den første besked til afdelingen.');feedEmpty.hidden=true;scroller.append(older,feed,feedEmpty);
    const jump=button('Nye beskeder ↓',()=>{newCount=0;scrollBottom();paintJump();markRead();},'cs-button cs-chat-new-messages');jump.hidden=true;
    const composer=node('form','cs-chat-composer'),composerFrame=node('div','cs-chat-composer-frame'),input=node('textarea','cs-chat-compose-input');input.rows=2;input.maxLength=MAX_TEXT;input.placeholder='Skriv til afdelingen…';input.setAttribute('aria-label','Skriv en besked');
    const composeFoot=node('div','cs-chat-compose-foot'),hint=node('span','cs-chat-compose-hint','Enter sender · Shift + Enter skifter linje'),send=button('Send',sendMessage,'cs-button cs-chat-send');send.setAttribute('aria-label','Send besked');composeFoot.append(hint,send);composerFrame.append(input,composeFoot);const composeStatus=node('p','cs-chat-compose-status');composeStatus.hidden=true;composeStatus.setAttribute('role','status');composer.append(composerFrame,composeStatus);
    headCopy.append(threadStatus);headActions.append(retry);body.append(head,preview,pinned,scroller,jump,composer);thread.append(empty,body);root.append(sidebar,thread);
    const modal=node('div','cs-chat-modal-layer');modal.hidden=true;const backdrop=button('',()=>closeModal(),'cs-chat-modal-backdrop');backdrop.setAttribute('aria-label','Luk chatrummets indstillinger');
    const dialog=node('section','cs-chat-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Opret chatrum');
    const modalHead=node('header','cs-chat-dialog-head'),modalTitle=node('h3','','Opret chatrum'),modalClose=button('×',()=>closeModal(),'cs-chat-icon-button');modalClose.setAttribute('aria-label','Luk chatrummets indstillinger');modalHead.append(modalTitle,modalClose);
    const modalForm=node('form','cs-chat-dialog-form'),departmentField=node('label','cs-field'),departmentLabel=node('span','cs-field-label','Afdeling'),departmentSelect=node('select','cs-chat-input');departmentSelect.setAttribute('aria-label','Afdeling');departmentField.append(departmentLabel,departmentSelect);
    const nameField=node('label','cs-field'),nameLabel=node('span','cs-field-label','Navn på chatrum'),nameInput=node('input','cs-chat-input');nameInput.type='text';nameInput.maxLength=120;nameInput.required=true;nameInput.setAttribute('aria-label','Navn på chatrum');nameField.append(nameLabel,nameInput);
    const modalHint=node('p','cs-chat-dialog-hint','Medarbejdere med fast arbejdssted i afdelingen får automatisk adgang.'),modalError=node('p','cs-chat-error');modalError.hidden=true;modalError.setAttribute('role','alert');const modalFoot=node('footer','cs-chat-dialog-foot'),cancel=button('Annuller',()=>closeModal(),'cs-button cs-chat-button'),confirm=button('Opret chatrum',saveRoom,'cs-button cs-chat-send');modalFoot.append(cancel,confirm);modalForm.append(departmentField,nameField,modalHint,modalError,modalFoot);dialog.append(modalHead,modalForm);modal.append(backdrop,dialog);root.append(modal);
    function currentRoom(){return rooms.find(room=>room.id===selected)||null;}
    const visible=()=>active&&!disposed&&doc.visibilityState!=='hidden';
    const nearBottom=()=>scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop<90;
    function scrollBottom(){scroller.scrollTop=scroller.scrollHeight;}
    function paintJump(){jump.hidden=!newCount;jump.textContent=newCount===1?'1 ny besked ↓':newCount+' nye beskeder ↓';}
    function loadedUnread(){return rooms.reduce((sum,room)=>sum+(!room.muted?Math.max(0,Number(room.unread)||0):0),0);}
    function roomUnread(){if(loaded||listError)onUnread(Math.max(0,unreadRemainder+loadedUnread()));}
    function mergedRoom(previous,room){return {...previous,...room,...(Number(previous?.latestSeq)>Number(room.latestSeq)?{latestSeq:previous.latestSeq,lastMessage:previous.lastMessage}:{}),...(Number(previous?.version)>Number(room.version)?{version:previous.version,name:previous.name}:{})};}
    function rememberRoom(room){if(!room||typeof room.id!=='string')return;const index=rooms.findIndex(item=>item.id===room.id);if(index<0)rooms.push(room);else rooms[index]=mergedRoom(rooms[index],room);}
    function wakeSync(){idleRound=0;nextIdleSyncAt=0;}
    function scheduleSync(unchanged){if(!unchanged)idleRound=0;nextIdleSyncAt=now()+[1000,2000,5000,10000][idleRound];if(unchanged)idleRound=Math.min(3,idleRound+1);}
    function resetSync(){syncedThrough=null;syncedVersion=null;syncPending=false;syncRequest++;syncFailures=0;nextSyncAt=0;syncError='';wakeSync();}
    function adoptReadSequence(fresh){if(syncedThrough===null)syncedThrough=Math.max(0,...fresh.map(sequence));else for(const message of sortMessages(fresh)){if(sequence(message)===syncedThrough+1)syncedThrough++;}}
    function safeError(error,fallback){return error?.message||fallback;}
    function acceptAccess(result,startedAccess){
      const next=result?.accessKey;if(typeof next!=='string'||!next)return true;
      if(accessKey&&next!==accessKey){if(startedAccess!==accessEpoch)return false;accessEpoch++;rooms=[];departments=[];listCursor=null;loaded=false;canManage=false;unreadRemainder=0;messages=[];pins=[];messageCursor=null;hasMore=false;lastFeedSignature='';lastPinSignature='';lastRoomSignature='';feed.replaceChildren();pinned.replaceChildren();pinned.hidden=true;lastMarked.clear();resetSync();}
      accessKey=next;return true;
    }
    function deny(error){
      if(![401,403,404].includes(error?.status)&&!(error?.status===409&&error?.code==='chat_access_changed'))return false;
      if(selected)drafts.set(selected,input.value);rooms=[];departments=[];selected=null;messages=[];pins=[];messageCursor=null;hasMore=false;unreadRemainder=0;canManage=false;lastFeedSignature='';lastPinSignature='';lastRoomSignature='';threadError=safeError(error,'Din adgang til samtalen er ændret.');listError=threadError;roomEpoch++;threadPending=false;olderPending=false;resetSync();modal.hidden=true;modalState=null;feed.replaceChildren();pinned.replaceChildren();pinned.hidden=true;input.value='';input.disabled=true;send.disabled=true;emptyTitle.textContent='Samtalen er ikke tilgængelig';emptyCopy.textContent=threadError;paintRooms();paintThreadHead();return true;
    }
    function bellIcon(muted){
      const svg=doc.createElementNS?.('http://www.w3.org/2000/svg','svg');if(!svg)return node('span','','◌');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
      for(const d of ['M7.5 15.5a2.5 2.5 0 0 0 5 0','M4.5 13.5h11l-1.3-2V8a4.2 4.2 0 0 0-8.4 0v3.5l-1.3 2',...(muted?['M3 3l14 14']:[])]){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}return svg;
    }
    async function call(action,payload={}){
      if(typeof onAction!=='function')throw Error('Chatten er ikke tilgængelig lige nu.');
      const result=await onAction(action,payload);
      if(result?.ok===false){const error=Error(result.message||'Handlingen kunne ikke gennemføres. Prøv igen.');error.status=result.status;error.code=result.error||result.code;throw error;}
      return result?.data&&typeof result.data==='object'?result.data:result||{};
    }
    async function readRoom(payload){for(let attempt=0;;attempt++){try{return await call('chatRead',payload);}catch(error){if(attempt||error?.code!=='chat_sync_changed')throw error;}}}
    function paintRooms(){
      if(disposed)return;
      listStatus.hidden=(!listPending||listSilent)&&!listError;listStatus.textContent=listError||(!loaded?'Henter chatrum…':'Opdaterer chatrum…');listStatus.title=listStatus.textContent;moreRooms.disabled=listPending;roomUnread();
      const signature=JSON.stringify({rooms,selected,canManage,readonly,emptyPending:!rooms.length&&listPending,listError,listCursor});if(signature===lastRoomSignature)return;lastRoomSignature=signature;
      createButton.hidden=!canManage||readonly;demoButton.hidden=!canManage||readonly;moreRooms.hidden=!listCursor;moreRooms.disabled=listPending;
      const previousScroll=roomList.scrollTop;roomList.replaceChildren();
      if(!rooms.length&&!listPending){const title=node('h3','cs-chat-no-rooms-title',listError?'Chatrum kunne ikke hentes':'Ingen chatrum endnu'),copy=node('p','cs-chat-no-rooms',canManage?'Opret et rum til en afdeling, eller prøv eksempelrummene.':'Din administrator kan oprette et rum til din afdeling.');roomList.append(title,copy);if(listError)roomList.append(button('Prøv igen',()=>loadRooms(),'cs-button cs-chat-button'));}
      for(const room of rooms){
        const entry=button('',()=>selectRoom(room.id),'cs-chat-room');entry.dataset.roomId=room.id;entry.dataset.selected=String(selected===room.id);entry.setAttribute('aria-pressed',String(selected===room.id));entry.setAttribute('aria-label',room.name+(room.unread?' · '+room.unread+' ulæste':'')+(room.muted?' · notifikationer slået fra':''));
        const mark=node('span','cs-chat-room-mark','#');mark.setAttribute('aria-hidden','true');const copy=node('span','cs-chat-room-copy'),top=node('span','cs-chat-room-top');top.append(node('strong','',room.name));if(Number(room.unread)>0){const count=node('span','cs-chat-unread',Number(room.unread)>99?'99+':room.unread);count.setAttribute('aria-hidden','true');top.append(count);}copy.append(top,node('span','cs-chat-room-department',room.departmentName===room.name?room.memberCount+' medlemmer':room.departmentName));
        const last=room.lastMessage;copy.append(node('span','cs-chat-room-snippet',last?(last.authorName?last.authorName+': ':'')+last.text:'Start samtalen'));if(room.muted){const muted=node('span','cs-chat-room-muted','Notifikationer slået fra');copy.append(muted);}entry.append(mark,copy);roomList.append(entry);
      }roomList.scrollTop=previousScroll;roomUnread();
    }
    function paintThreadHead(){
      const room=currentRoom();if(!room){body.hidden=true;composer.hidden=true;empty.hidden=false;root.dataset.threadOpen='false';return;}
      body.hidden=false;empty.hidden=true;roomTitle.textContent=room.name;roomMeta.textContent=room.departmentName+' · '+room.memberCount+' medlemmer';settings.hidden=!canManage||readonly;mute.hidden=readonly;mute.replaceChildren(bellIcon(room.muted));mute.dataset.muted=String(room.muted===true);mute.title=room.muted?'Slå notifikationer til':'Slå notifikationer fra';mute.setAttribute('aria-label',mute.title);preview.hidden=!readonly;composer.hidden=readonly;feedEmpty.textContent=readonly?'Ingen beskeder i dette chatrum endnu.':'Ingen beskeder endnu. Skriv den første besked til afdelingen.';input.disabled=threadPending&&!messages.length||Boolean(threadError);send.disabled=!canSend();thread.setAttribute('aria-label','Chat: '+room.name);
      older.hidden=!hasMore;older.disabled=olderPending;threadStatus.hidden=!threadError&&!syncError&&(!threadPending||threadSilent);threadStatus.textContent=threadError||syncError||(messages.length?'Opdaterer samtalen…':'Henter beskeder…');threadStatus.title=threadStatus.textContent;retry.hidden=!threadError&&!syncError;
    }
    function paintPins(){
      const signature=JSON.stringify([selected,canManage,readonly,pins]);if(signature===lastPinSignature)return;lastPinSignature=signature;
      const expanded=new Set([...pinned.children].filter(item=>item.dataset?.messageId&&item.open).map(item=>item.dataset.messageId)),scrollTop=pinned.scrollTop;
      pinned.replaceChildren();pinned.hidden=!pins.length;if(!pins.length)return;const label=node('div','cs-chat-pinned-label','Fastgjort');pinned.append(label);
      for(const message of pins){const detail=node('details','cs-chat-pin'),summary=node('summary','cs-chat-pin-summary'),previewText=text(message.text);detail.dataset.messageId=message.id;detail.open=expanded.has(message.id);summary.append(node('strong','',message.authorName||'Medarbejder'),node('span','',previewText.length>130?previewText.slice(0,130)+'…':previewText));const full=node('p','cs-chat-pin-body',previewText);detail.append(summary,full);if(canManage&&!readonly){const unpin=button('Frigør',()=>pinMessage(message,false),'cs-chat-text-button');detail.append(unpin);}pinned.append(detail);}pinned.scrollTop=scrollTop;
    }
    function paintMessages({bottom=false,prepend=false}={}){
      const pinIds=new Set(pins.map(message=>message.id)),signature=JSON.stringify(messages.map(message=>[message.id,message.seq,message.text,message.authorId,message.authorName,message.createdAt,message.demo,pinIds.has(message.id)]));
      const oldTop=scroller.scrollTop||0,oldHeight=scroller.scrollHeight||0;
      const changed=signature!==lastFeedSignature;
      if(changed){lastFeedSignature=signature;feed.replaceChildren();let previousDay=null,previousAuthor=null;
        for(const message of messages){const day=dayKey(message.createdAt);if(day!==previousDay){const divider=node('div','cs-chat-date-divider',dateLabel(message.createdAt));feed.append(divider);previousDay=day;previousAuthor=null;}
          const own=message.authorId===options.viewer?.userId,article=node('article','cs-chat-message');article.dataset.messageId=message.id;article.dataset.own=String(own);article.dataset.grouped=String(previousAuthor===message.authorId);article.setAttribute('aria-label',(message.authorName||'Medarbejder')+' '+clock(message.createdAt));
          const avatar=node('span','cs-chat-avatar',initials(message.authorName));avatar.setAttribute('aria-hidden','true');const content=node('div','cs-chat-message-content'),meta=node('header','cs-chat-message-meta');meta.append(node('strong','',own?'Dig':message.authorName||'Medarbejder'));const time=node('time','',clock(message.createdAt));time.dateTime=message.createdAt;meta.append(time);if(pinIds.has(message.id))meta.append(node('span','cs-chat-message-pinned','Fastgjort'));content.append(meta,node('p','cs-chat-message-text',text(message.text)));
          if(canManage&&!readonly){const more=node('details','cs-chat-message-menu'),trigger=node('summary','','⋯');trigger.setAttribute('aria-label','Muligheder for besked fra '+(message.authorName||'medarbejder'));const action=button(pinIds.has(message.id)?'Frigør besked':'Fastgør besked',()=>{more.open=false;pinMessage(message,!pinIds.has(message.id));},'cs-chat-message-menu-action');more.append(trigger,action);content.append(more);}article.append(avatar,content);feed.append(article);previousAuthor=message.authorId;
        }
      }
      feedEmpty.hidden=messages.length>0||threadPending||Boolean(threadError);older.hidden=!hasMore;older.disabled=olderPending;
      if(bottom&&changed)scrollBottom();else if(prepend)scroller.scrollTop=oldTop+(scroller.scrollHeight-oldHeight);else scroller.scrollTop=oldTop;
    }
    function draftFor(id=selected){return drafts.get(id)||'';}
    function canSend(){return Boolean(selected&&!readonly&&!sendingRoom&&!threadError&&text(input.value).trim()&&input.value.length<=MAX_TEXT);}
    function composerFeedback(message='',error=false){statusText=message;composeStatus.hidden=!message;composeStatus.textContent=message;composeStatus.dataset.error=String(error);send.disabled=!canSend();}
    function resetThread(){resetSync();messages=[];pins=[];messageCursor=null;hasMore=false;threadError='';newCount=0;lastFeedSignature='';lastPinSignature='';feed.replaceChildren();pinned.hidden=true;input.value=draftFor();composerFeedback();paintJump();}
    function loadRooms(append=false,configuration={}){
      if(listPending&&catalogPromise)return catalogPromise;
      const request=readRooms(append,configuration);catalogPromise=request;request.finally(()=>{if(catalogPromise===request)catalogPromise=null;});return request;
    }
    async function readRooms(append=false,{silent=false}={}){
      if(disposed||!active||listPending&&append)return;const started=epoch,startedAccess=accessEpoch,previousCursor=listCursor,previouslyLoaded=loaded,request=++listRequest;listPending=true;listSilent=silent;listError='';paintRooms();
      try{const result=await call('chatList',append&&listCursor?{cursor:listCursor}:{});if(disposed||started!==epoch||request!==listRequest||!acceptAccess(result,startedAccess))return;
        readonly=result.readonly===true||options.readonly===true;canManage=result.canManage===true&&!readonly;if(result.viewer&&!options.viewer?.userId)options.viewer=result.viewer;
        const previousRooms=new Map(rooms.map(room=>[room.id,room])),next=list(result.rooms).map(room=>mergedRoom(previousRooms.get(room.id),room)),retained=!append&&previouslyLoaded&&rooms.length>next.length;rooms=append?[...new Map([...rooms,...next].map(room=>[room.id,room])).values()]:retained?[...next,...rooms.filter(room=>!next.some(item=>item.id===room.id))]:next;departments=list(result.departments);listCursor=retained?previousCursor:result.nextCursor||null;loaded=true;listError='';lastCatalogAt=now();if(Number.isSafeInteger(result.unreadCount))unreadRemainder=result.unreadCount-loadedUnread();
        if(selected&&!rooms.some(room=>room.id===selected)){selected=null;roomEpoch++;resetThread();}
        else if(selected&&syncedThrough!==null&&(Number(currentRoom()?.latestSeq)>syncedThrough||Number(currentRoom()?.version)>syncedVersion))wakeSync();
        paintRooms();paintThreadHead();if(!selected&&rooms.length&&!append)await selectRoom(rooms[0].id,{open:false});
      }catch(error){if(disposed||started!==epoch||request!==listRequest)return;listError=safeError(error,'Chatrum kunne ikke hentes.');if(!deny(error)){lastCatalogAt=now();if(!loaded){syncFailures++;nextSyncAt=now()+Math.min(30000,1000*2**Math.min(syncFailures,5));}}paintThreadHead();}
      finally{if(!disposed&&started===epoch&&request===listRequest){listPending=false;listSilent=false;paintRooms();}}
    }
    async function selectRoom(id,{open=true}={}){
      if(!rooms.some(room=>room.id===id))return;if(selected!==id){if(selected)drafts.set(selected,input.value);selected=id;roomEpoch++;threadRequest++;threadPending=false;olderPending=false;resetThread();}if(open)root.dataset.threadOpen='true';paintRooms();paintThreadHead();await loadThread(id,{initial:!messages.length});
    }
    function showRooms(){root.dataset.threadOpen='false';[...roomList.children].find(item=>item.dataset.roomId===selected)?.focus?.({preventScroll:true});}
    async function loadThread(id=selected,{initial=false,silent=false}={}){
      if(disposed||!active||!id||id!==selected)return;const started=epoch,startedAccess=accessEpoch,selection=roomEpoch,request=++threadRequest;threadPending=true;threadSilent=silent;threadError='';syncError='';const previousLatest=Math.max(0,...messages.map(sequence));paintThreadHead();
      try{const result=await readRoom({roomId:id,limit:50});if(disposed||started!==epoch||selection!==roomEpoch||request!==threadRequest||id!==selected||!acceptAccess(result,startedAccess))return;
        const bottom=initial||nearBottom();rememberRoom(result.room);const fresh=list(result.messages);messages=sortMessages([...messages,...fresh]);pins=list(result.pins);adoptReadSequence(fresh);syncedVersion=result.room?.version||syncedVersion;syncFailures=0;nextSyncAt=0;wakeSync();if(initial||!messageCursor){messageCursor=result.nextCursor||null;hasMore=result.hasMore===true;}
        const arrived=fresh.filter(message=>sequence(message)>previousLatest&&message.authorId!==options.viewer?.userId).length;if(!bottom&&previousLatest&&arrived)newCount+=arrived;
        threadPending=false;threadError='';paintPins();paintMessages({bottom});paintThreadHead();paintRooms();paintJump();if(bottom)await markRead();
      }catch(error){if(disposed||started!==epoch||selection!==roomEpoch||request!==threadRequest)return;threadError=safeError(error,'Beskederne kunne ikke hentes.');if(!deny(error)){syncFailures++;nextSyncAt=now()+Math.min(30000,1000*2**Math.min(syncFailures,5));}paintThreadHead();}
      finally{if(!disposed&&started===epoch&&selection===roomEpoch&&request===threadRequest){threadPending=false;threadSilent=false;paintThreadHead();}}
    }
    async function loadOlder(){
      if(!selected||!hasMore||!messageCursor||olderPending)return;const id=selected,started=epoch,startedAccess=accessEpoch,selection=roomEpoch,cursor=messageCursor;olderPending=true;older.disabled=true;
      try{const result=await readRoom({roomId:id,before:cursor,limit:50});if(disposed||started!==epoch||selection!==roomEpoch||selected!==id||!acceptAccess(result,startedAccess))return;messages=sortMessages([...list(result.messages),...messages]);messageCursor=result.nextCursor||null;hasMore=result.hasMore===true;if(result.room?.version===syncedVersion)pins=list(result.pins);rememberRoom(result.room);paintPins();paintMessages({prepend:true});paintRooms();}
      catch(error){if(!disposed&&started===epoch&&selection===roomEpoch){if(!deny(error))composerFeedback(safeError(error,'Ældre beskeder kunne ikke hentes.'),true);}}
      finally{if(!disposed&&started===epoch&&selection===roomEpoch){olderPending=false;older.disabled=false;older.hidden=!hasMore;}}
    }
    async function markRead(){
      if(!visible()||readonly||marking||!selected||threadError||!nearBottom()||!modal.hidden||thread.getClientRects&&thread.getClientRects().length===0)return;const throughSeq=syncedThrough??0,id=selected;if(!throughSeq||(lastMarked.get(id)||0)>=throughSeq)return;
      const started=epoch,startedAccess=accessEpoch,selection=roomEpoch;marking=true;
      try{const result=await call('chatReadMark',{roomId:id,throughSeq});if(disposed||started!==epoch||selection!==roomEpoch||!acceptAccess(result,startedAccess))return;lastMarked.set(id,throughSeq);rememberRoom(result.room);paintRooms();}
      catch(error){if(!disposed&&started===epoch)deny(error);}
      finally{marking=false;}
    }
    async function sendMessage(){
      if(!canSend())return;wakeSync();const id=selected,body=input.value,started=epoch,startedAccess=accessEpoch,selection=roomEpoch;let pending=pendingSends.get(id);if(!pending||pending.text!==body){pending={text:body,clientId:globalThis.crypto?.randomUUID?.()||'chat-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)};pendingSends.set(id,pending);}sendingRoom=id;send.disabled=true;composerFeedback('Sender…');
      try{const result=await call('chatSend',{roomId:id,text:pending.text,clientId:pending.clientId});if(disposed||started!==epoch||!acceptAccess(result,startedAccess))return;pendingSends.delete(id);if(drafts.get(id)===body)drafts.delete(id);rememberRoom(result.room);
        if(selected===id&&selection===roomEpoch){if(input.value===body){input.value='';drafts.delete(id);}messages=sortMessages([...messages,...(result.message?[result.message]:[])]);newCount=0;paintMessages({bottom:true});paintJump();composerFeedback('Sendt');input.focus?.({preventScroll:true});await markRead();}paintRooms();
      }catch(error){if(!disposed&&started===epoch&&selected===id&&selection===roomEpoch){if(!deny(error))composerFeedback(safeError(error,'Beskeden blev ikke sendt. Prøv igen.'),true);}}
      finally{if(!disposed&&started===epoch){sendingRoom=null;send.disabled=!canSend();if(visible())syncThread();}}
    }
    async function toggleMute(){
      const room=currentRoom();if(!room||readonly||mutationBusy)return;const started=epoch,startedAccess=accessEpoch;mutationBusy=true;mute.disabled=true;
      try{const result=await call('chatMute',{roomId:room.id,muted:!room.muted});if(disposed||started!==epoch||!acceptAccess(result,startedAccess))return;rememberRoom(result.room);paintRooms();paintThreadHead();}
      catch(error){if(!disposed&&started===epoch){if(!deny(error))composerFeedback(safeError(error,'Notifikationerne kunne ikke ændres.'),true);}}
      finally{if(!disposed&&started===epoch){mutationBusy=false;mute.disabled=false;}}
    }
    async function pinMessage(message,pin){
      const room=currentRoom();if(!room||!canManage||readonly||mutationBusy)return;const started=epoch,selection=roomEpoch;mutationBusy=true;
      try{const result=await call('chatPin',{roomId:room.id,messageId:message.id,pinned:pin,version:room.version});if(disposed||started!==epoch||selection!==roomEpoch)return;await loadThread(room.id);}
      catch(error){if(!disposed&&started===epoch&&selection===roomEpoch){if(!deny(error))composerFeedback(safeError(error,'Beskeden kunne ikke fastgøres.'),true);}}
      finally{if(!disposed&&started===epoch)mutationBusy=false;}
    }
    function openRoomModal(room=null){
      if(!canManage||readonly)return;modalTrigger=doc.activeElement;modalState=room?{id:room.id,version:room.version,departmentId:room.departmentId}:{};modalTitle.textContent=room?'Rediger chatrum':'Opret chatrum';dialog.setAttribute('aria-label',modalTitle.textContent);confirm.textContent=room?'Gem ændringer':'Opret chatrum';departmentSelect.replaceChildren();
      const available=room?departments:departments.filter(department=>!department.hasRoom);for(const department of available){const option=node('option','',department.name+' · '+department.memberCount+' medlemmer');option.value=department.id;departmentSelect.append(option);}if(room&&!available.some(department=>department.id===room.departmentId)){const option=node('option','',room.departmentName);option.value=room.departmentId;departmentSelect.append(option);}departmentSelect.value=room?.departmentId||available[0]?.id||'';departmentSelect.disabled=Boolean(room);nameInput.value=room?.name||available[0]?.name||'';nameInput.disabled=false;modalError.hidden=true;modalHint.textContent=!room&&!available.length?'Alle afdelinger har allerede et chatrum.':'Medarbejdere med fast arbejdssted i afdelingen får automatisk adgang.';confirm.disabled=!room&&!available.length;modal.hidden=false;nameInput.focus?.({preventScroll:true});
    }
    function closeModal(){if(mutationBusy)return;modal.hidden=true;modalState=null;modalTrigger?.focus?.({preventScroll:true});}
    async function saveRoom(){
      if(!modalState||mutationBusy||!canManage||readonly||confirm.disabled)return;const name=nameInput.value.trim();if(!name){modalError.textContent='Giv chatrummet et navn.';modalError.hidden=false;nameInput.focus?.();return;}const started=epoch,form=modalState,departmentId=departmentSelect.value;mutationBusy=true;confirm.disabled=true;modalError.hidden=true;
      try{const result=await call(form.id?'chatUpdate':'chatCreate',form.id?{roomId:form.id,version:form.version,name}:{departmentId,name});if(disposed||started!==epoch)return;mutationBusy=false;closeModal();if(result.room)rememberRoom(result.room);await loadRooms();if(result.room?.id)await selectRoom(result.room.id);}
      catch(error){if(!disposed&&started===epoch&&modalState===form){if(!deny(error)){modalError.textContent=safeError(error,'Chatrummet kunne ikke gemmes.');modalError.hidden=false;}}}
      finally{if(!disposed&&started===epoch){mutationBusy=false;confirm.disabled=false;}}
    }
    async function seedDemo(){
      if(!canManage||readonly||mutationBusy)return;const started=epoch;mutationBusy=true;demoButton.disabled=true;
      try{await call('chatDemo');if(disposed||started!==epoch)return;await loadRooms();}
      catch(error){if(!disposed&&started===epoch){if(!deny(error)){listError=safeError(error,'Eksempelrummene kunne ikke oprettes.');paintRooms();}}}
      finally{if(!disposed&&started===epoch){mutationBusy=false;demoButton.disabled=false;}}
    }
    async function syncThread(){
      if(!visible()||!selected||syncedThrough===null||!Number.isSafeInteger(syncedVersion)||syncPending||threadPending||olderPending||sendingRoom||mutationBusy||now()<nextSyncAt||now()<nextIdleSyncAt)return;
      const id=selected,started=epoch,selection=roomEpoch,request=++syncRequest,readRequest=threadRequest;syncPending=true;
      try{
        for(let page=0;page<4;page++){
          if(!visible()||started!==epoch||selection!==roomEpoch||request!==syncRequest||readRequest!==threadRequest||id!==selected||syncedThrough===null||!Number.isSafeInteger(syncedVersion))return;
          const afterSeq=syncedThrough,version=syncedVersion,startedAccess=accessEpoch,result=await call('chatSync',{roomId:id,afterSeq,version,limit:50});
          if(!visible()||started!==epoch||selection!==roomEpoch||request!==syncRequest||readRequest!==threadRequest||id!==selected||!acceptAccess(result,startedAccess))return;
          if(accessEpoch!==startedAccess){await loadRooms(false,{silent:true});if(visible()&&selected)await loadThread(selected,{initial:true,silent:true});return;}
          const fresh=list(result.messages),through=result.throughSeq;
          if(!Number.isSafeInteger(through)||through<afterSeq||!Number.isSafeInteger(result.version)||result.version<version||result.unchanged!==true&&(result.room?.id!==id||fresh.some((message,index)=>sequence(message)!==afterSeq+index+1)||through!==(fresh.length?sequence(fresh.at(-1)):afterSeq)||result.version!==version&&!Array.isArray(result.pins))){const error=Error('Samtalens opdatering kunne ikke bekræftes. Åbn chatten igen.');error.status=409;error.code='chat_access_changed';throw error;}
          if(result.unchanged===true&&(through!==afterSeq||result.version!==version)){const error=Error('Samtalen ændrede sig under opdateringen.');error.code='chat_sync_changed';throw error;}
          syncFailures=0;nextSyncAt=0;syncError='';threadError='';scheduleSync(result.unchanged===true);
          if(result.unchanged!==true){
            const bottom=nearBottom(),known=new Set(messages.map(message=>message.id)),arrived=fresh.filter(message=>!known.has(message.id)&&message.authorId!==options.viewer?.userId).length;
            rememberRoom(result.room);messages=sortMessages([...messages,...fresh]);if(Array.isArray(result.pins))pins=result.pins;syncedThrough=through;syncedVersion=result.version;
            if(!bottom&&arrived)newCount+=arrived;paintPins();paintMessages({bottom});paintRooms();paintJump();
          }
          paintThreadHead();await markRead();
          if(result.hasMoreNew!==true)return;
          if(through===afterSeq)throw Error('Samtalens nye beskeder kunne ikke hentes.');
        }
      }catch(error){
        if(!disposed&&started===epoch&&selection===roomEpoch&&request===syncRequest){
          if(!deny(error)){if(error?.code==='chat_sync_changed')nextSyncAt=now()+1000;else{syncFailures++;nextSyncAt=now()+Math.min(30000,1000*2**Math.min(syncFailures,5));syncError='Kunne ikke hente nye beskeder. Prøver igen…';paintThreadHead();}}
        }
      }finally{if(request===syncRequest)syncPending=false;}
    }
    async function refresh(){if(!visible()||listPending||threadPending||olderPending||syncPending||sendingRoom||mutationBusy)return;const prior=selected;await loadRooms(false,{silent:loaded});if(visible()&&selected&&selected===prior)await loadThread(selected,{silent:true});}
    async function poll(){
      if(!visible()||listPending||threadPending||olderPending||syncPending||sendingRoom||mutationBusy||now()<nextSyncAt)return;
      const prior=selected;
      if(!loaded||now()-lastCatalogAt>=15000)await loadRooms(false,{silent:loaded});
      if(!visible()||!selected||prior!==selected)return;
      if(syncedThrough===null)await loadThread(selected,{initial:true,silent:messages.length>0});else await syncThread();
    }
    function syncTimer(){if(timer!==null){(win.clearInterval||clearInterval)(timer);timer=null;}if(visible())timer=(win.setInterval||setInterval)(()=>{if(visible())poll();},1000);}
    function setActive(value){if(disposed)return;const next=value===true;if(next===active)return;active=next;if(!active){epoch++;roomEpoch++;listRequest++;threadRequest++;syncRequest++;syncPending=false;listPending=false;threadPending=false;olderPending=false;marking=false;sendingRoom=null;mutationBusy=false;modal.hidden=true;modalState=null;}syncTimer();if(active){wakeSync();const prior=selected;loadRooms(false,{silent:loaded}).then(()=>{if(visible()&&selected&&selected===prior){if(syncedThrough===null)loadThread(selected,{initial:!messages.length,silent:messages.length>0});else syncThread();}});}}
    function visibility(){syncTimer();if(visible()){wakeSync();nextSyncAt=0;poll();}}
    input.addEventListener('input',()=>{if(selected)drafts.set(selected,input.value);composerFeedback();});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendMessage();}});composer.addEventListener('submit',event=>{event.preventDefault();sendMessage();});
    scroller.addEventListener('scroll',()=>{if(nearBottom()){newCount=0;paintJump();markRead();}});departmentSelect.addEventListener('change',()=>{const department=departments.find(item=>item.id===departmentSelect.value);if(department)nameInput.value=department.name;});modalForm.addEventListener('submit',event=>{event.preventDefault();saveRoom();});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeModal();return;}if(event.key!=='Tab')return;const candidates=[modalClose,departmentSelect,nameInput,cancel,confirm].filter(el=>!el.disabled&&!el.hidden),first=candidates[0],last=candidates.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus?.();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus?.();}});
    doc.addEventListener?.('visibilitychange',visibility);
    win.addEventListener?.('focus',visibility);
    return {
      render(next={}){if(disposed)return;const merged={...options,...next},key=[merged.workspaceId||'',merged.viewer?.userId||'',merged.scopeKey||'',merged.readonly===true?'preview':'account'].join('|');if(identity&&key!==identity){setActive(false);accessKey='';accessEpoch++;unreadRemainder=0;epoch++;roomEpoch++;rooms=[];departments=[];selected=null;loaded=false;readonly=false;canManage=false;listPending=false;threadPending=false;drafts.clear();pendingSends.clear();lastMarked.clear();resetThread();lastRoomSignature='';}identity=key;options=merged;readonly=merged.readonly===true||readonly;root.dataset.employee=String(merged.employee===true);if(next.active!==undefined)setActive(next.active);else if(!active)setActive(true);paintRooms();paintThreadHead();},
      setActive,refresh,load:()=>loadRooms(),
      destroy(){if(disposed)return;setActive(false);disposed=true;epoch++;doc.removeEventListener?.('visibilitychange',visibility);win.removeEventListener?.('focus',visibility);drafts.clear();pendingSends.clear();element.replaceChildren();},
      dispose(){this.destroy();}
    };
  }
  const api=Object.freeze({mount,initials,sortMessages});globalThis.CleanRoomsChat=api;if(typeof module==='object'&&module.exports)module.exports=api;
})();
