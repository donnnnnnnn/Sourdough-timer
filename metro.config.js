const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle .tflite models as assets so `require('../assets/model/crumb_classifier.tflite')`
// resolves through Metro (react-native-fast-tflite loads them via require()).
config.resolver.assetExts.push('tflite');

module.exports = config;
