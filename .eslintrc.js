module.exports = {
  parser: "@typescript-eslint/parser",
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: ["next", "prettier", "plugin:prettier/recommended"],
  ignorePatterns: [
    "node_modules/",
    "build/",
    ".next/",
    "public/assets/js/",
    "postcss.config.js",
    ".eslintrc.js",
    "tailwind.config.js",
    "next.config.js",
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint", "prettier"],
  rules: {
    "@typescript-eslint/prefer-nullish-coalescing": 0,
    "@typescript-eslint/strict-boolean-expressions": 0,
    "@typescript-eslint/explicit-function-return-type": 0,
    "prettier/prettier": "error",
  },
};
