// 把 react/jsx-dev-runtime 在 prod build 时重定向到这里。
// 某些第三方包发布产物时硬编码了 `import { jsxDEV } from 'react/jsx-dev-runtime'`，
// React prod build 不暴露 jsxDEV → 运行时 `jsxDEV is not a function`。
// 这里用 prod 的 jsx 模拟 jsxDEV：多余参数（source/self/isStaticChildren）会被忽略，渲染等价。
const jsxRuntime = require('react/jsx-runtime');
module.exports = {
  ...jsxRuntime,
  jsxDEV: jsxRuntime.jsx,
};
