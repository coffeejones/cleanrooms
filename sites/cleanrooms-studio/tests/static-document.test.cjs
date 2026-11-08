const test=require('node:test'),assert=require('node:assert/strict');
const {createStaticDocument}=require('../lib/static-document.mjs');
const request=(headers={},method='GET')=>new Request('https://cleanrooms.example/',{method,headers});

test('only an unchanged static shell revalidates without a response body, always privately',async()=>{
 const content='<!doctype html><p>Invariant application shell Æ</p>',serve=createStaticDocument(content),first=await serve(request());
 assert.equal(first.status,200);assert.equal(await first.text(),content);assert.equal(first.headers.get('cache-control'),'private, no-cache');assert.match(first.headers.get('etag'),/^"[a-f0-9]{64}"$/);
 for(const validator of [first.headers.get('etag'),'W/'+first.headers.get('etag'),'"outdated", W/'+first.headers.get('etag'),'*']){
  const cached=await serve(request({'if-none-match':validator}));assert.equal(cached.status,304);assert.equal(await cached.text(),'');assert.equal(cached.headers.get('etag'),first.headers.get('etag'));assert.equal(cached.headers.get('cache-control'),'private, no-cache');
 }
 const changed=await createStaticDocument(content+'<p>New release</p>')(request({'if-none-match':first.headers.get('etag')}));assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),first.headers.get('etag'));assert.match(await changed.text(),/New release/);
});

test('unknown validators cannot suppress a new shell and HEAD retains the same validator without a body',async()=>{
 const serve=createStaticDocument('<html>Shell</html>'),first=await serve(request());
 for(const validator of ['"unrelated"','W/"unrelated"','malformed',first.headers.get('etag')+'-suffix']){
  const result=await serve(request({'if-none-match':validator}));assert.equal(result.status,200);assert.equal(await result.text(),'<html>Shell</html>');
 }
 const head=await serve(request({},'HEAD'));assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('etag'),first.headers.get('etag'));
});
