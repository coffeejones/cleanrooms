const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withQuotedReactNativeScript(config) {
  return withXcodeProject(config, (mod) => {
    const phases = mod.modResults.hash.project.objects.PBXShellScriptBuildPhase;

    for (const phase of Object.values(phases)) {
      if (phase?.name !== '"Bundle React Native code and images"') continue;

      // Keep the resolved React Native script path together when the project path contains spaces.
      const script = JSON.parse(phase.shellScript);
      phase.shellScript = JSON.stringify(
        script.replace(/^`(.+\/scripts\/react-native-xcode\.sh.+)`$/m, '"$($1)"'),
      );
    }

    return mod;
  });
};
