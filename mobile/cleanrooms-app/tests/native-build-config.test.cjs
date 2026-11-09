const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildConfig } = require('../scripts/native-build-config.cjs');
const base = require('../app.json').expo;
const unlinkedBase = { ...base, extra: { ...base.extra, eas: undefined } };
const projectId = '12345678-1234-4234-8234-123456789012';
const release = { EAS_BUILD_PROFILE: 'production', EXPO_PROJECT_ID: projectId, EXPO_PUBLIC_CLEANROOMS_AUTH_URL: 'https://mobile-api.example.test' };

test('distributable builds require the linked Expo project and a public HTTPS API origin', () => {
  for (const profile of ['preview','production']) {
    assert.throws(() => buildConfig(unlinkedBase, { ...release, EAS_BUILD_PROFILE:profile, EXPO_PROJECT_ID:undefined }), /Expo project/);
    for (const origin of [undefined,'http://127.0.0.1:8791','https://[::1]','https://172.16.0.1','https://user:password@api.example.test','https://api.example.test/path','https://api.example.test?token=x','https://api.example.test#x','https://localhost','https://phone.local']) {
      assert.throws(() => buildConfig(base, { ...release, EAS_BUILD_PROFILE:profile, EXPO_PUBLIC_CLEANROOMS_AUTH_URL:origin }), /HTTPS origin/);
    }
  }
  const config=buildConfig(base,release);
  assert.equal(config.extra.eas.projectId,projectId);
  assert.equal(config.ios.bundleIdentifier,base.ios.bundleIdentifier);
  assert.equal(config.scheme,base.scheme);
});

test('simulator/local builds stay usable before Expo linking without inventing a project identity', () => {
  for(const profile of ['local','simulator']) {
    const config=buildConfig(unlinkedBase,{EAS_BUILD_PROFILE:profile});
    assert.equal(config.extra?.eas?.projectId,undefined);
  }
  assert.throws(()=>buildConfig(base,{EXPO_PROJECT_ID:'placeholder'}),/real Expo project UUID/);
  assert.throws(()=>buildConfig(base,{APPLE_TEAM_ID:'not-a-team'}),/Apple team/);
});

test('pilot and TestFlight profiles embed a Release bundle and cannot require a development client', () => {
  const eas=require('../eas.json');
  for(const name of ['preview','production','simulator']) {
    assert.equal(eas.build[name].developmentClient,false,name);
    assert.equal(eas.build[name].ios.buildConfiguration,'Release',name);
  }
  assert.equal(eas.build.preview.distribution,'internal');
  assert.equal(eas.build.production.distribution,'store');
  assert.equal(eas.build.simulator.ios.simulator,true);
  const plugin=base.plugins.filter(item=>Array.isArray(item)&&item[0]==='expo-notifications');
  assert.equal(plugin.length,1);
  assert.equal(plugin[0][1].enableBackgroundRemoteNotifications,false,'visible push does not need silent background execution');
  assert.equal(base.plugins.filter(item=>item==='expo-secure-store').length,1);
  assert.match(fs.readFileSync(path.join(__dirname,'../.easignore'),'utf8'), /^credentials\.json$/m, 'signing credentials must be excluded from the source upload');
});

const { verifyReleaseMetadata } = require('../scripts/verify-ios-release.cjs');
const releaseInfo = () => ({ CFBundleIdentifier:base.ios.bundleIdentifier,CFBundleShortVersionString:base.version,CFBundleVersion:'2',
  NSLocationWhenInUseUsageDescription:'Placering bruges ved indstempling.',NSMotionUsageDescription:'Denne metadata er påkrævet af placeringens native bibliotek.',
  ITSAppUsesNonExemptEncryption:false });

test('compiled iOS release metadata catches the first IPA motion-purpose rejection before submission', () => {
  for(const build of ['1','2','1.0.0','10.20.30']) assert.doesNotThrow(()=>verifyReleaseMetadata({...releaseInfo(),CFBundleVersion:build},base));
  for(const value of [undefined,false,null,'','   ','$(MOTION_USAGE_DESCRIPTION)']) {
    assert.throws(()=>verifyReleaseMetadata({...releaseInfo(),NSMotionUsageDescription:value},base),/NSMotionUsageDescription/);
  }
  for(const value of [undefined,true,'false']) {
    assert.throws(()=>verifyReleaseMetadata({...releaseInfo(),ITSAppUsesNonExemptEncryption:value},base),/export-compliance/);
  }
  assert.throws(()=>verifyReleaseMetadata({...releaseInfo(),CFBundleVersion:''},base),/build version/);
  assert.throws(()=>verifyReleaseMetadata({...releaseInfo(),NSLocationWhenInUseUsageDescription:undefined},base),/NSLocationWhenInUseUsageDescription/);
});

test('native purpose metadata does not enable always-on location or a motion permission request', () => {
  const location=base.plugins.find(item=>Array.isArray(item)&&item[0]==='expo-location')[1];
  assert.ok(typeof location.motionUsagePermission==='string'&&location.motionUsagePermission.trim().length>0);
  assert.equal(location.locationAlwaysPermission,false);
  assert.equal(location.locationAlwaysAndWhenInUsePermission,false);
  assert.equal(base.ios.config.usesNonExemptEncryption,false);
  for(const patch of [
    {NSLocationAlwaysUsageDescription:'Always'}, {NSLocationAlwaysAndWhenInUseUsageDescription:'Always'}, {UIBackgroundModes:['location']},
    {NSAppTransportSecurity:{NSAllowsArbitraryLoads:true}},
  ]) assert.throws(()=>verifyReleaseMetadata({...releaseInfo(),...patch},base));
  const ts=require('typescript'),forbiddenModules=new Set(['expo-sensors','expo-motion','react-native-sensors']);
  const forbiddenCalls=new Set(['requestBackgroundPermissionsAsync','startLocationUpdatesAsync','startGeofencingAsync','requestMotionPermissionsAsync']);
  function inspect(directory) {
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory()) { inspect(file);continue; }
      if(!/\.tsx?$/.test(entry.name))continue;
      const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
      function visit(node) {
        if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)) assert.ok(!forbiddenModules.has(node.moduleSpecifier.text),`Unexpected motion module in ${file}`);
        if(ts.isCallExpression(node)) {
          if(node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0])) assert.ok(!forbiddenModules.has(node.arguments[0].text),`Unexpected motion module in ${file}`);
          if(ts.isPropertyAccessExpression(node.expression)) assert.ok(!forbiddenCalls.has(node.expression.name.text),`Unexpected motion/background permission call in ${file}`);
        }
        ts.forEachChild(node,visit);
      }
      visit(tree);
    }
  }
  inspect(path.join(__dirname,'../src'));
});
