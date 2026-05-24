/**
 * Tailwind v4 ships its PostCSS plugin via @tailwindcss/postcss.
 * Vite already wires Tailwind through @tailwindcss/vite, so this file
 * exists only for non-Vite tooling (Storybook addon-postcss, IDE).
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
