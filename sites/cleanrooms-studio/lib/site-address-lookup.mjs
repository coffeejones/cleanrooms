import proj4 from 'proj4';
import {StudioError} from './studio-store.mjs';

const endpoint='https://adressevaelger.dk/husnumre/';
const defaultToken='adressevaelger123';
const utm32='+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs';
const addressId=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const controlCharacters=/[\u0000-\u001f\u007f]/;
const countrySuffix=/[\s,]+(?:Danmark|Denmark)$/i;

function addressLabel(value){
  if(typeof value!=='string'||!value.trim()||value.length>490||controlCharacters.test(value))return null;
  return value.trim().replace(countrySuffix,'')+', Danmark';
}

function unavailable(){
  return new StudioError(503,'address_lookup_unavailable','Adresseopslaget kunne ikke gennemføres. Prøv igen om lidt.');
}

async function lookup(path,params,token){
  const url=new URL(path,endpoint);
  url.search=new URLSearchParams({...params,token:token||defaultToken}).toString();
  try{
    const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000),redirect:'manual'});
    if(!response.ok)throw unavailable();
    const result=await response.json();
    if(result?.status!=='ok')throw unavailable();
    return result;
  }catch{
    throw unavailable();
  }
}

export async function lookupSiteAddress({id,query},token){
  if(id!==undefined){
    if(query!==undefined||typeof id!=='string'||!addressId.test(id))throw new StudioError(400,'address_invalid','Vælg en adresse fra forslagene.');
    const result=await lookup(id.toLowerCase(),{},token);
    const house=result.husnummer,point=house?.adgangspunkt?.geometri;
    const address=addressLabel(house?.adgangsadressebetegnelse);
    if(!address||typeof house.id_lokalid!=='string'||house.id_lokalid.toLowerCase()!==id.toLowerCase()||point?.type!=='Point'||point.crs?.properties?.name!=='EPSG:25832'||
      !Array.isArray(point.coordinates)||point.coordinates.length!==2||!point.coordinates.every(Number.isFinite))throw unavailable();
    const [longitude,latitude]=proj4(utm32,'EPSG:4326',point.coordinates);
    if(!(longitude>=7&&longitude<=16&&latitude>=54&&latitude<=58))throw unavailable();
    return {address,latitude,longitude};
  }
  if(typeof query!=='string'||controlCharacters.test(query))throw new StudioError(400,'address_query_invalid','Skriv en gyldig adresse.');
  const term=query.trim().replace(countrySuffix,'').trim();
  if(term.length<3||term.length>73)throw new StudioError(400,'address_query_invalid','Skriv mellem 3 og 73 tegn for at søge efter en adresse.');
  const result=await lookup('soeg',{tekst:term,maksimum:'8'},token);
  if(!Array.isArray(result.fund))throw unavailable();
  const suggestions=new Map();
  for(const item of result.fund){
    const address=addressLabel(item?.titel);
    if(item?.type==='husnummer'&&typeof item.id==='string'&&addressId.test(item.id)&&address)suggestions.set(item.id,{id:item.id,address});
  }
  return {suggestions:[...suggestions.values()].slice(0,8)};
}
