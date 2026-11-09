const { getDefaultConfig } = require('expo/metro-config');
const { prepareDependencySecurity } = require('./scripts/dependency-security.cjs');

// Fail before bundling if install scripts were skipped or a reviewed adapter drifted.
prepareDependencySecurity({ check: true });
module.exports = getDefaultConfig(__dirname);
