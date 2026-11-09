const { buildConfig } = require('./scripts/native-build-config.cjs');

module.exports = ({ config }) => buildConfig(config, process.env);
