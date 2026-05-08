import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "#0f1117",
          surface: "#1a1d27",
          border: "#2a2d3a",
          accent: "#6366f1",
          "accent-hover": "#4f52d4",
          muted: "#6b7280",
          text: "#e2e8f0",
          "text-dim": "#94a3b8",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
