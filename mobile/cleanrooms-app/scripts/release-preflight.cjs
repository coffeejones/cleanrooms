const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildConfig } = require('./native-build-config.cjs');
const root = path.resolve(__dirname,'..');
const profile = process.argv[2] || 'preview';
if (!['preview','production'].includes(profile)) throw new Error('Use preview or production.');
const config = buildConfig(require('../app.json').expo,{...process.env,EAS_BUILD_PROFILE:profile});
// Build the reviewable repository, never an unrelated/uncommitted parent workspace.
const repository = execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim();
execFileSync('git',['rev-parse','--verify','HEAD'],{cwd:repository,stdio:'pipe'});
const relative = path.relative(repository,root);
if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The app must be inside its source repository.');
execFileSync('git',['ls-files','--error-unmatch',path.join(relative,'app.json')],{cwd:repository,stdio:'pipe'});
const ignore = fs.readFileSync(path.join(repository,'.easignore'),'utf8');
for(const entry of ['credentials.json','*.p8','*.p12','.env','.env.*']) {
  if(!ignore.split(/\r?\n/).some(line=>line===entry||line==='**/'+entry)) throw new Error('The repository-root build upload must exclude signing material and local environment files.');
}
console.log(JSON.stringify({profile,name:config.name,bundleIdentifier:config.ios.bundleIdentifier,projectId:config.extra.eas.projectId,sourceReady:true,buildConfiguration:'Release'}));
