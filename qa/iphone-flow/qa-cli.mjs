import assert from 'node:assert/strict';
const args=process.argv.slice(2),isPilot=args.includes('--pilot');
const [command='status',input='{}']=args.filter(value=>value!=='--pilot');
assert.ok(['status','publish','change','cancel','clock','review','approve','reject','correct','fault','chat','personal-rate','requests','decide-request','expire-session','shutdown'].includes(command),'Unknown local QA command');
const response=await fetch('http://127.0.0.1:'+(isPilot?8793:8791)+'/qa/'+command,{method:'POST',headers:{'content-type':'application/json','x-cleanrooms-qa':'local-only'},body:JSON.stringify(JSON.parse(input))});
const result=await response.json();console.log(JSON.stringify(result,null,2));if(!response.ok)process.exitCode=1;
