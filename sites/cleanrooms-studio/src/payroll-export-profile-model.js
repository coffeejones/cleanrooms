/* CSV configuration only: columns are allowlisted data fields, never expressions or code. */
(() => {
  'use strict';
  const kinds=['attendance','base','supplement','monthly_base','monthly_supplement'];
  const fields=[['employeeNumber','Lønnummer'],['wageCode','Lønart'],['hours','Timer'],['quantity','Antal'],['calculation','Beregningstype'],['rateDKK','Sats i kroner'],['amountDKK','Beløb i kroner'],['employeeId','Medarbejder-id'],['name','Navn'],['date','Arbejdsdato'],['sourceEntryId','Registrering'],['lineKind','Type'],['label','Løndel'],['workedMinutes','Arbejdsminutter'],['minutes','Lønminutter'],['rateCents','Sats i øre'],['amountCents','Beløb i øre'],['currency','Valuta'],['from','Gælder fra'],['to','Gælder til'],['days','Dage'],['cycleDays','Dage i lønperioden'],['allocationBasis','Fordelingsgrundlag'],['monthDays','Fordelingsdage (ældre data)'],['periodFrom','Periode fra'],['periodTo','Periode til'],['revision','Afslutningsversion'],['constant','Fast værdi']];
  const fieldNames=new Set(fields.map(([key])=>key));
  const record=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
  const text=(value,max=100)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
  const id=value=>text(value,512)&&/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value);
  const fail=message=>{throw new TypeError(message);};
  const exact=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  function defaults(){return {schema:1,name:'Mit CSV-format',delimiter:';',decimal:',',header:true,hoursDecimals:4,rowKinds:['base','supplement','monthly_base','monthly_supplement'],requireEmployeeNumbers:true,requireWageCodes:true,
    columns:[{field:'employeeNumber',header:'Lønnummer'},{field:'wageCode',header:'Lønart'},{field:'quantity',header:'Antal'},{field:'rateDKK',header:'Sats'},{field:'amountDKK',header:'Beløb'}],employeeNumbers:{},wageCodes:[]};}
  function normalize(input){
    if(!exact(input,['schema','name','delimiter','decimal','header','hoursDecimals','rowKinds','requireEmployeeNumbers','requireWageCodes','columns','employeeNumbers','wageCodes'])||(input.schema??1)!==1)return fail('Eksportprofilen indeholder ukendte indstillinger.');
    if(!text(input.name,100)||!input.name.trim()||![';',',','\t'].includes(input.delimiter)||!['.',','].includes(input.decimal)||typeof input.header!=='boolean'||![2,4].includes(input.hoursDecimals))return fail('Vælg navn og gyldige CSV-indstillinger.');
    if(!Array.isArray(input.rowKinds)||!input.rowKinds.length||input.rowKinds.length>kinds.length||input.rowKinds.some(kind=>!kinds.includes(kind))||new Set(input.rowKinds).size!==input.rowKinds.length)return fail('Vælg mindst én posttype til eksporten.');
    if(typeof input.requireEmployeeNumbers!=='boolean'||typeof input.requireWageCodes!=='boolean')return fail('Vælg, om lønnumre og lønarter er påkrævet.');
    if(!Array.isArray(input.columns)||!input.columns.length||input.columns.length>32)return fail('Vælg mellem 1 og 32 CSV-kolonner.');
    const columns=input.columns.map(column=>{
      if(!exact(column,['field','header','value'])||!fieldNames.has(column.field)||!text(column.header,100)||input.header&&!column.header.trim()||column.field==='constant'&&!text(column.value,200)||column.field!=='constant'&&column.value!==undefined)return fail('Kontrollér kolonnernes felter, overskrifter og faste værdier.');
      return {field:column.field,header:column.header,...(column.field==='constant'?{value:column.value}:{})};
    });
    if(!record(input.employeeNumbers)||Object.keys(input.employeeNumbers).length>10000)return fail('Der er for mange medarbejdernumre i profilen.');
    const employeeNumbers=Object.create(null),usedNumbers=new Set();
    for(const [personId,number] of Object.entries(input.employeeNumbers).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)){if(!id(personId)||!text(number,60)||!number.trim())return fail('Kontrollér medarbejdernes lønnumre.');const cleaned=number.trim();if(usedNumbers.has(cleaned))return fail('Lønnummer '+cleaned+' bruges til flere medarbejdere. Lønnumre skal være entydige.');usedNumbers.add(cleaned);employeeNumbers[personId]=cleaned;}
    if(!Array.isArray(input.wageCodes)||input.wageCodes.length>300)return fail('Vælg højst 300 regler for lønarter.');
    const seen=new Set(),wageCodes=input.wageCodes.map(rule=>{
      if(!exact(rule,['kind','label','code'])||!kinds.includes(rule.kind)||!text(rule.label,200)||!text(rule.code,60)||!rule.code.trim())return fail('Kontrollér reglernes type, løndelsnavn og lønart.');
      const key=JSON.stringify([rule.kind,rule.label.trim()]);if(seen.has(key))return fail('Der er flere lønarter for den samme type og det samme løndelsnavn.');seen.add(key);
      return {kind:rule.kind,label:rule.label.trim(),code:rule.code.trim()};
    });
    const result={schema:1,name:input.name.trim(),delimiter:input.delimiter,decimal:input.decimal,header:input.header,hoursDecimals:input.hoursDecimals,rowKinds:[...input.rowKinds],requireEmployeeNumbers:input.requireEmployeeNumbers,requireWageCodes:input.requireWageCodes,columns,employeeNumbers,wageCodes};
    if(new TextEncoder().encode(JSON.stringify(result)).byteLength>1024*1024)return fail('Eksportprofilen fylder for meget. Brug højst 1 MB.');
    return result;
  }
  function decimalInteger(value,divisor,places,separator){
    if(!Number.isSafeInteger(value))return fail('En lønpost har et ugyldigt tal.');
    const n=BigInt(value),negative=n<0n,absolute=negative?-n:n,scale=10n**BigInt(places);
    const scaled=(absolute*scale+BigInt(divisor)/2n)/BigInt(divisor),whole=scaled/scale,fraction=String(scaled%scale).padStart(places,'0');
    return (negative&&scaled?'-':'')+String(whole)+(places?separator+fraction:'');
  }
  function decimalQuantity(value,places,separator){
    if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)return fail('Den afsluttede lønpost mangler et gyldigt godkendt antal. Vælg et format uden Antal for denne version.');
    const negative=value<0,[coefficient,exponent='0']=String(Math.abs(value)).toLowerCase().split('e'),parts=coefficient.split('.'),digits=BigInt(parts.join('')),shift=places+Number(exponent)-(parts[1]?.length??0),scale=10n**BigInt(places);
    const rounded=shift>=0?digits*10n**BigInt(shift):(digits+(10n**BigInt(-shift))/2n)/(10n**BigInt(-shift));
    return (negative&&rounded?'-':'')+String(rounded/scale)+separator+String(rounded%scale).padStart(places,'0');
  }
  function cell(value,{numeric=false}={}){
    let content=String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');if(!numeric&&/^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(content))content="'"+content;
    return '"'+content.replace(/"/g,'""')+'"';
  }
  function serialize(rows,input,{header=true}={}){
    const profile=normalize(input),usesEmployee=profile.columns.some(column=>column.field==='employeeNumber'),usesCode=profile.columns.some(column=>column.field==='wageCode');
    if(!Array.isArray(rows)||rows.length>500)return fail('Hent eksporten i afgrænsede sider.');
    const exactCodes=new Map(profile.wageCodes.map(rule=>[JSON.stringify([rule.kind,rule.label]),rule.code]));
    const selected=rows.filter(row=>{if(!record(row)||!kinds.includes(row.lineKind))return fail('En lønpost kunne ikke læses sikkert.');return profile.rowKinds.includes(row.lineKind);}),missingPeople=new Set(),missingCodes=new Set();
    const lines=selected.map(row=>{
      if(!record(row)||!id(row.employeeId)||!kinds.includes(row.lineKind))return fail('En lønpost kunne ikke læses sikkert.');
      const number=Object.hasOwn(profile.employeeNumbers,row.employeeId)?profile.employeeNumbers[row.employeeId]:'';
      const code=exactCodes.get(JSON.stringify([row.lineKind,String(row.label??'').trim()]))??exactCodes.get(JSON.stringify([row.lineKind,'']))??'';
      if(usesEmployee&&profile.requireEmployeeNumbers&&!number)missingPeople.add(String(row.name||row.employeeId));
      if(usesCode&&profile.requireWageCodes&&!code)missingCodes.add(String(row.label||row.lineKind));
      return profile.columns.map(column=>{
        const field=column.field;
        if(field==='employeeNumber')return cell(number);
        if(field==='wageCode')return cell(code);
        if(field==='constant')return cell(column.value);
        if(field==='hours')return cell(decimalInteger(row.lineKind==='attendance'?row.workedMinutes:row.minutes,60,profile.hoursDecimals,profile.decimal),{numeric:true});
        if(field==='quantity')return cell(decimalQuantity(row.quantity,profile.hoursDecimals,profile.decimal),{numeric:true});
        if(field==='rateDKK'||field==='amountDKK')return cell(decimalInteger(row[field==='rateDKK'?'rateCents':'amountCents'],100,2,profile.decimal),{numeric:true});
        const value=row[field];if(value!==undefined&&value!==null&&typeof value!=='string'&&typeof value!=='number')return fail('En CSV-kolonne indeholder ugyldige data.');
        if(typeof value==='number'&&!Number.isSafeInteger(value))return fail('En lønpost har et ugyldigt tal.');
        return cell(value,{numeric:typeof value==='number'});
      }).join(profile.delimiter)+'\r\n';
    });
    if(missingPeople.size)return fail('Udfyld lønnummer for '+[...missingPeople].slice(0,3).join(', ')+(missingPeople.size>3?' og flere medarbejdere.':'.'));
    if(missingCodes.size)return fail('Udfyld lønart for '+[...missingCodes].slice(0,3).join(', ')+(missingCodes.size>3?' og flere løndele.':'.'));
    return (header&&profile.header?'\uFEFF'+profile.columns.map(column=>cell(column.header)).join(profile.delimiter)+'\r\n':'')+lines.join('');
  }
  const api=Object.freeze({fields,kinds,defaults,normalize,serialize,decimalInteger,decimalQuantity});globalThis.CleanRoomsPayrollExportProfileModel=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
