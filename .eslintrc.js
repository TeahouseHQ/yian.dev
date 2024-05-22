module.exports = {
  parser: "@typescript-eslint/parser",
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: ["next"],
  ignorePatterns: [
    "node_modules/",
    "build/",
    ".next/",
    ".eslintrc.js",
    "tailwind.config.js",
    "next.config.js",
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint", "import"],
  rules: {
    "@typescript-eslint/prefer-nullish-coalescing": 0,
    "@typescript-eslint/strict-boolean-expressions": 0,
    "@typescript-eslint/explicit-function-return-type": 0,
    "import/order": [
      "error",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling", "index"],
        ],
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
  },
};
