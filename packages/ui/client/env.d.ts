/// <reference types="@rsbuild/core/types" />

// CSS is a build-time side-effect import (UnoCSS via postcss) with no JS exports.
declare module '*.css'
