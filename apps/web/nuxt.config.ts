export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/fonts", "@pinia/nuxt"],
  css: ["~/assets/css/globals.css"],
  ssr: true,
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
    // Avoid downloading/self-hosting font files during the Docker build
    // (fonts.gstatic.com can be unreachable or return stale 404s in CI),
    // load them from Google's CDN at runtime instead.
    google: {
      download: false,
    },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || "http://localhost:3001",
    },
  },
});
