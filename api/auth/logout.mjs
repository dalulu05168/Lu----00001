// Explicit Vercel file-system API route. Deep /api/auth/* paths
// must not depend on the single-file catch-all being recognized.
import handler from "../[...path].mjs";

export default function logoutHandler(req, res) {
  req.url = "/api/auth/logout";
  return handler(req, res);
}
