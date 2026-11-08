/* Cache only the invariant application shell. Tenant records and transport
   responses retain no-store; every document reuse still revalidates with Sites. */
export function createStaticDocument(html){
  if(typeof html!=='string')throw new TypeError('A static document must be text.');
  let tag;
  return async function document(request){
    // Start Web Crypto inside a request; Worker module evaluation stays synchronous.
    tag??=crypto.subtle.digest('SHA-256',new TextEncoder().encode(html)).then(bytes=>'"'+[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('')+'"');
    const etag=await tag,headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-cache','ETag':etag};
    const match=request.headers.get('if-none-match');
    // Weak validators are valid for GET/HEAD revalidation. Other opaque tags
    // never match our hex-only digest, even if a header contains commas.
    const unchanged=match?.split(',').some(value=>{const candidate=value.trim();return candidate==='*'||candidate.replace(/^W\//,'')===etag;});
    if(unchanged&&(request.method==='GET'||request.method==='HEAD'))return new Response(null,{status:304,headers});
    return new Response(request.method==='HEAD'?null:html,{headers});
  };
}
