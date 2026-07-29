const { createServer } = require("node:http");
const next = require("next");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((request, response) => {
      handle(request, response);
    }).listen(port, () => {
      console.log(`wacrm listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start wacrm", error);
    process.exit(1);
  });
