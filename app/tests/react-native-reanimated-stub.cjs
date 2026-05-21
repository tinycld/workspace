// Vitest stub for react-native-reanimated.
// The real package initializes native TurboModules at import time which fails
// in a Node test environment. This stub exposes the minimal surface used by
// unit-test import chains (Animated components, animation primitives).
'use strict'

const React = require('react')
const noop = () => {}

const noopAnimation = { start: noop, stop: noop, reset: noop }

class AnimatedValue {
    constructor(value) { this._value = value }
    setValue(value) { this._value = value }
    interpolate() { return this }
}

const Animated = {
    View: 'View',
    Text: 'Text',
    Image: 'Image',
    ScrollView: 'ScrollView',
    Value: AnimatedValue,
    createAnimatedComponent: (Component) => Component,
    timing: () => noopAnimation,
    spring: () => noopAnimation,
    decay: () => noopAnimation,
    parallel: () => noopAnimation,
    sequence: () => noopAnimation,
    delay: () => noopAnimation,
}

function useSharedValue(initial) {
    return { value: initial }
}

function useAnimatedStyle() {
    return {}
}

function withSpring(value) { return value }
function withTiming(value) { return value }
function withDelay(_, animation) { return animation }
function withRepeat(animation) { return animation }
function withSequence(...animations) { return animations[0] }

const FadeIn = { duration: noop, delay: noop }
const FadeOut = { duration: noop, delay: noop }
const ZoomIn = { duration: noop, delay: noop }
const ZoomOut = { duration: noop, delay: noop }
const SlideInUp = { duration: noop, delay: noop }
const SlideOutDown = { duration: noop, delay: noop }
const Easing = {
    linear: (t) => t,
    ease: (t) => t,
    bezier: () => (t) => t,
    in: (f) => f,
    out: (f) => f,
    inOut: (f) => f,
}

function runOnJS(fn) { return fn }
function runOnUI(fn) { return fn }
function useAnimatedGestureHandler() { return {} }
function useAnimatedRef() { return { current: null } }
function useAnimatedScrollHandler() { return noop }
function useDerivedValue(fn) { return { value: fn() } }
function useAnimatedReaction() {}
function cancelAnimation() {}
function makeMutable(value) { return { value } }

module.exports = {
    __esModule: true,
    default: Animated,
    Animated,
    // Also surface createAnimatedComponent at top level for any
    // import Animated from 'react-native-reanimated' that gets the full object
    createAnimatedComponent: Animated.createAnimatedComponent,
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    withDelay,
    withRepeat,
    withSequence,
    FadeIn,
    FadeOut,
    ZoomIn,
    ZoomOut,
    SlideInUp,
    SlideOutDown,
    Easing,
    runOnJS,
    runOnUI,
    useAnimatedGestureHandler,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useDerivedValue,
    useAnimatedReaction,
    cancelAnimation,
    makeMutable,
    interpolate: (v) => v,
    Extrapolation: { CLAMP: 'CLAMP', EXTEND: 'EXTEND', IDENTITY: 'IDENTITY' },
}
