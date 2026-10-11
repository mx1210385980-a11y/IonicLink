import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        xs: ["0.875rem", { lineHeight: "1.25rem" }],
        sm: ["1rem", { lineHeight: "1.5rem" }],
        base: ["1.0625rem", { lineHeight: "1.625rem" }],
      },
      // Text contrast is independent of the neutral border and surface palette.
      textColor: {
        ink: {
          400: "#263958",
          500: "#263958",
          600: "#263958",
          700: "#20324d",
          800: "#172b4d",
          900: "#132238",
          950: "#101c30",
        },
      },
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
          950: "#161616",
          900: "#262626",
          800: "#393939",
          700: "#525252",
          600: "#6f6f6f",
          500: "#6f6f6f",
          400: "#8d8d8d",
          300: "#c6c6c6",
          200: "#e0e0e0",
          100: "#f4f4f4",
          50: "#f8f8f8",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        serif: ["ui-serif", "Georgia", "Cambria", '"Times New Roman"', "serif"],
      },
      boxShadow: {
        panel: "none",
        card: "0 1px 2px rgba(22, 22, 22, 0.05)",
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
