import { startApp } from "./app.ts";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container in index.html");
}

startApp(container);
