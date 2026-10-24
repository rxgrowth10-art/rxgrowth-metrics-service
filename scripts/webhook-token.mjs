import { createHash, randomBytes } from "node:crypto";

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token, "utf8").digest("hex");
process.stdout.write(`${hash}\n`);
process.stderr.write(
  "Webhook token printed once below. Store the hash above on the tenant. Put the token only in the GoHighLevel webhook URL as ?t=\n",
);
process.stderr.write(`${token}\n`);
