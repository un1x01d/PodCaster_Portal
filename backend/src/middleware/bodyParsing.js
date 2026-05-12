import express from "express";

export function applyBodyParsingMiddleware(app, env = process.env) {
  const jsonBodyLimit = String(env.JSON_BODY_LIMIT || "1mb").trim() || "1mb";
  const urlencodedBodyLimit = String(env.URLENCODED_BODY_LIMIT || "1mb").trim() || "1mb";
  app.use((req, _res, next) => {
    req.body_limits = { json: jsonBodyLimit, urlencoded: urlencodedBodyLimit };
    next();
  });
  app.use(express.json({ limit: jsonBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: urlencodedBodyLimit }));
}
