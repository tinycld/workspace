'use strict'

// Stub for react-native in unit tests. Vite/Rollup cannot parse react-native's
// Flow type syntax or its CJS/ESM hybrid internals. This provides the minimal
// surface that tests reference transitively via core hooks.
module.exports = {
    Platform: { OS: 'web', select: (map) => map.web ?? map.default },
    Dimensions: {
        get: () => ({ width: 1024, height: 768 }),
        addEventListener: () => ({ remove: () => {} }),
    },
    StatusBar: {
        currentHeight: 0,
        setBarStyle: () => {},
        setBackgroundColor: () => {},
    },
    StyleSheet: { create: (s) => s, flatten: (s) => s, compose: (a, b) => [a, b] },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    TextInput: 'TextInput',
    Image: 'Image',
    Modal: 'Modal',
    TouchableOpacity: 'TouchableOpacity',
    TouchableHighlight: 'TouchableHighlight',
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    SectionList: 'SectionList',
    SafeAreaView: 'SafeAreaView',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Animated: {
        View: 'View',
        Text: 'Text',
        Value: class {
            constructor(v) { this._value = v }
            setValue(v) { this._value = v }
            interpolate() { return this }
        },
        timing: () => ({ start: () => {} }),
        spring: () => ({ start: () => {} }),
        parallel: () => ({ start: () => {} }),
        sequence: () => ({ start: () => {} }),
        createAnimatedComponent: (c) => c,
    },
    Easing: { linear: (t) => t, ease: (t) => t, bezier: () => (t) => t },
    PixelRatio: { get: () => 2, roundToNearestPixel: (n) => n },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove: () => {} }) },
    I18nManager: { isRTL: false },
    Linking: { openURL: () => Promise.resolve(), canOpenURL: () => Promise.resolve(true) },
    AccessibilityInfo: { isScreenReaderEnabled: () => Promise.resolve(false) },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 1024, height: 768, scale: 1, fontScale: 1 }),
}
