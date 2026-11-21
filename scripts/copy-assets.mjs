import { mkdir, copyFile } from "node:fs/promises";

const destination = new URL("../dist/src/docs/", import.meta.url);
await mkdir(destination, { recursive: true });
await Promise.all([
  copyFile(new URL("../src/docs/greencode-swagger.css", import.meta.url), new URL("greencode-swagger.css", destination)),
  copyFile(new URL("../src/docs/greencode-swagger-sidebar.js", import.meta.url), new URL("greencode-swagger-sidebar.js", destination)),
]);
