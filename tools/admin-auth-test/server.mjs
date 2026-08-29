import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4173;
const files = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/main.js", { name: "main.js", type: "text/javascript; charset=utf-8" }],
]);

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
  const file = files.get(pathname);

  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": file.type,
  });
  createReadStream(fileURLToPath(new URL(file.name, import.meta.url))).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Local auth test available at http://${host}:${port}`);
});
