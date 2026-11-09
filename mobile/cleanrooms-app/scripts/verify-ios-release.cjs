const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

function purposeString(info,key) {
  assert.ok(typeof info[key]==='string'&&info[key].trim().length>0&&!/\$\([^)]+\)/.test(info[key]),`${key} must contain an actual nonempty purpose string before App Store upload.`);
}
function verifyReleaseMetadata(info,expected) {
  assert.equal(info.CFBundleIdentifier,expected.ios.bundleIdentifier,'The compiled app must use the intended bundle identifier.');
  assert.equal(info.CFBundleShortVersionString,expected.version,'The compiled version must match the intended app version.');
  assert.ok(typeof info.CFBundleVersion==='string'&&/^\d+(?:\.\d+){0,2}$/.test(info.CFBundleVersion),'The compiled app must include a numeric build version.');
  purposeString(info,'NSLocationWhenInUseUsageDescription');
  // Expo Location 57 links CoreMotion even when the app never requests motion.
  // Apple's binary scan still requires this metadata (ITMS-90683).
  purposeString(info,'NSMotionUsageDescription');
  assert.equal(expected.ios.config?.usesNonExemptEncryption,false,'Review export compliance before declaring the app distributable.');
  assert.equal(info.ITSAppUsesNonExemptEncryption,false,'The compiled app must declare its reviewed export-compliance value before upload.');
  assert.notEqual(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads,true,'A standalone release must not bypass HTTPS.');
  assert.equal(info.NSLocationAlwaysUsageDescription,undefined,'The app must not request always-on location.');
  assert.equal(info.NSLocationAlwaysAndWhenInUseUsageDescription,undefined,'The app must not request always-on location.');
  assert.ok(info.UIBackgroundModes===undefined||Array.isArray(info.UIBackgroundModes),'Background modes must be an array when present.');
  assert.ok(!info.UIBackgroundModes?.includes('location'),'The app must not enable background location.');
}
function verifyIosRelease(appDirectory,expected=require('../app.json').expo) {
  const app=path.resolve(appDirectory||'');
  assert.ok(app.endsWith('.app'),'Provide a compiled Release .app directory (extract the app from the IPA before submission).');
  const info=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(app,'Info.plist')],{encoding:'utf8'}));
  verifyReleaseMetadata(info,expected);
  const bundle=path.join(app,'main.jsbundle');
  assert.ok(fs.existsSync(bundle)&&fs.statSync(bundle).size>0,'The Release app must embed its JavaScript, without needing Metro.');
  assert.ok(!fs.existsSync(path.join(app,'EXDevLauncher.bundle')),'A pilot release must not depend on a development launcher.');
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
  return {bundleIdentifier:info.CFBundleIdentifier,version:info.CFBundleShortVersionString,build:info.CFBundleVersion,embeddedJSBytes:fs.statSync(bundle).size,
    signatureVerified:true,arbitraryHTTPLoads:false,motionPurposePresent:true,nonExemptEncryption:false,backgroundLocation:false};
}
module.exports={verifyReleaseMetadata,verifyIosRelease};
if(require.main===module) console.log(JSON.stringify(verifyIosRelease(process.argv[2])));
