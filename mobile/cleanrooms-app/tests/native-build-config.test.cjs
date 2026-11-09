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
