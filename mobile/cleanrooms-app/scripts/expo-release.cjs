const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root=path.resolve(__dirname,'..'),profile=process.argv[2];
const check=spawnSync(process.execPath,[path.join(__dirname,'release-preflight.cjs'),profile],{cwd:root,stdio:'inherit'});
if(check.status!==0)process.exit(check.status||1);
const result=spawnSync('npx',['eas-cli@latest','build','--platform','ios','--profile',profile],{cwd:root,stdio:'inherit'});
process.exit(result.status===null?1:result.status);
