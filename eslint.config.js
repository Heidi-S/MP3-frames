import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier, // Must be placed at the very end to override everything else
  {
    files: ["**/*.cjs", "**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node, // 👈 This tells ESLint that 'console', 'process', etc. are valid globals
      },
    },
  },
);
