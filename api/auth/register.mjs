// Explicit Vercel file-system API route. Deep /api/auth/* paths
// must not depend on the single-file catch-all being recognized.
import handler from "../[...path].mjs";

export default function registerHandler(req, res) {
  req.url = "/api/auth/register";
  return handler(req, res);
}
