import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Teal accent system matching the IonicLink identity.
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
        // Cool graphite ink scale — the calm neutral backbone of the console.
        ink: {
          950: "#0a0f1a",
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
          600: "#475569",
          500: "#64748b",
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
          50: "#f8fafc",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        serif: ["ui-serif", "Georgia", "Cambria", '"Times New Roman"', "serif"],
      },
      boxShadow: {
        panel: "0 24px 60px -20px rgba(13, 148, 136, 0.18)",
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 30px -18px rgba(15, 23, 42, 0.18)",
        readout: "inset 0 1px 0 rgba(255,255,255,0.06), 0 14px 34px -18px rgba(8, 47, 43, 0.55)",
      },
      letterSpacing: {
        eyebrow: "0.16em",
      },
      keyframes: {
        "row-rise": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
