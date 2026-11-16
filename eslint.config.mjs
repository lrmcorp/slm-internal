import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  { ignores: [".next/**", "node_modules/**", "cctv/**"] },
  ...nextCoreWebVitals,
  {
    rules: {
      "import/no-anonymous-default-export": "off",
      "react-hooks/incompatible-library": "off"
    }
  }
];
