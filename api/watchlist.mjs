import handler from "./[...path].mjs";
export default function watchlistHandler(req,res) {
  req.url="/api/watchlist";
  return handler(req,res);
}
