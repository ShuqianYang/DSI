module.exports = function babelConfig(api) {
  const isDevelopment = api.env("development");

  return {
    ignore: ["node_modules"],
    presets: [
      [
        "next/babel",
        {
          "preset-react": {
            development: isDevelopment,
          },
        },
      ],
    ],
    plugins: [
      ...(isDevelopment ? ["@react-dev-inspector/babel-plugin"] : []),
      "@babel/plugin-transform-unicode-property-regex",
    ],
  };
};
