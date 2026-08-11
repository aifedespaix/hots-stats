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
        primary: "oklch(var(--color-primary) / <alpha-value>)",
        accent: "oklch(var(--color-accent) / <alpha-value>)",
        success: "oklch(var(--color-success) / <alpha-value>)",
        danger: "oklch(var(--color-danger) / <alpha-value>)",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
};
