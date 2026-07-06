// Ambient declaration so TypeScript accepts `require('../assets/model/crumb_classifier.tflite')`.
// react-native-fast-tflite consumes the numeric asset id that Metro returns for a required
// `.tflite` file (see metro.config.js, where `tflite` is registered as an asset extension).
declare module '*.tflite';
