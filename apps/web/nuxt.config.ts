export default defineNuxtConfig({
  compatibilityDate: "2026-08-15",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/fonts", "@pinia/nuxt"],
  css: ["~/assets/css/globals.css"],
  ssr: true,
  typescript: {
    typeCheck: true,
    strict: true,
  },
  app: {
    head: {
      htmlAttrs: { lang: "fr" },
      titleTemplate: "%s - HotS Analytics",
      link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
      meta: [
        { name: "theme-color", content: "#5500ff" },
        { name: "format-detection", content: "telephone=no" },
      ],
    },
  },
  colorMode: {
    preference: "dark",
    fallback: "dark",
    classSuffix: "",
    dataValue: "theme",
  },
  fonts: {
    families: [
      { name: "Outfit", provider: "google", weights: [400, 500, 600] },
      { name: "JetBrains Mono", provider: "google", weights: [400, 500, 600] },
    ],
    // `throwOnError` defaults to false: a fonts.gstatic.com hiccup during the
    // Docker build now logs a warning and falls back instead of failing the build.
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || "http://localhost:3001",
    },
  },
});
