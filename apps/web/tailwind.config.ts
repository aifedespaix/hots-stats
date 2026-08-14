import type { Config } from "tailwindcss";

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        background: "oklch(var(--color-background) / <alpha-value>)",
        surface: "oklch(var(--color-surface) / <alpha-value>)",
        border: "oklch(var(--color-border) / <alpha-value>)",
        foreground: "oklch(var(--color-foreground) / <alpha-value>)",
        muted: "oklch(var(--color-muted) / <alpha-value>)",
        // Named "brand" (not "primary"): @nuxt/ui reserves the "primary" key
        // and unconditionally overwrites it with its own rgb(var(...)) runtime
        // color system, discarding whatever is defined here. app.config.ts
        // points ui.primary at this "brand" color instead.
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
          DEFAULT: "oklch(var(--color-primary) / <alpha-value>)",
        },
        accent: "oklch(var(--color-accent) / <alpha-value>)",
        success: "oklch(var(--color-success) / <alpha-value>)",
        danger: "oklch(var(--color-danger) / <alpha-value>)",
        role: {
          tank: "oklch(var(--color-role-tank) / <alpha-value>)",
          bruiser: "oklch(var(--color-role-bruiser) / <alpha-value>)",
          ranged: "oklch(var(--color-role-ranged) / <alpha-value>)",
          melee: "oklch(var(--color-role-melee) / <alpha-value>)",
          healer: "oklch(var(--color-role-healer) / <alpha-value>)",
          support: "oklch(var(--color-role-support) / <alpha-value>)",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
};
