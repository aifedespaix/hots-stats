export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/fonts"],
  css: ["~/assets/css/globals.css"],
  ssr: true,
  colorMode: {
    preference: "dark",
    fallback: "dark",
    classSuffix: "",
    dataValue: "theme",
  },
  fonts: {
    families: [
      { name: "Space Grotesk", provider: "google", weights: [500, 600, 700] },
      { name: "Outfit", provider: "google", weights: [400, 500, 600] },
      { name: "JetBrains Mono", provider: "google", weights: [400, 500, 600] },
    ],
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || "http://localhost:3001",
    },
  },
});
