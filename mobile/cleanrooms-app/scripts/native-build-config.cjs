const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { isIP } = require('node:net');
const releaseProfiles = new Set(['preview', 'production']);
function httpsOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === '/' && !isIP(url.hostname.replace(/^\[|\]$/g, ''))
      && url.hostname.includes('.') && !/(^|\.)(?:localhost|local|internal)$/.test(url.hostname)
      ? url.origin : null;
  } catch { return null; }
}
function buildConfig(config, env = {}) {
  const profile = env.EAS_BUILD_PROFILE || 'local';
  const rawProjectId = env.EXPO_PROJECT_ID || config.extra?.eas?.projectId;
  if (rawProjectId && !uuid.test(rawProjectId)) throw new Error('EXPO_PROJECT_ID must be the real Expo project UUID.');
  const origin = env.EXPO_PUBLIC_CLEANROOMS_AUTH_URL;
  if (releaseProfiles.has(profile)) {
    if (!httpsOrigin(origin)) throw new Error('A preview/production build requires EXPO_PUBLIC_CLEANROOMS_AUTH_URL as a public HTTPS origin.');
    if (!rawProjectId) throw new Error('Link the real Expo project before creating a distributable push-enabled build.');
  }
  const team = env.APPLE_TEAM_ID || config.ios?.appleTeamId;
  if (team && !/^[A-Z0-9]{10}$/.test(team)) throw new Error('APPLE_TEAM_ID must be a 10-character Apple team identifier.');
  return {
    ...config,
    ios: { ...config.ios, ...(team ? { appleTeamId: team } : {}) },
    extra: {
      ...config.extra,
      ...(rawProjectId ? { eas: { ...config.extra?.eas, projectId: rawProjectId } } : {}),
    },
  };
}
module.exports = { buildConfig, httpsOrigin };
