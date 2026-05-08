User: Why is auth failing after the CORS change I made yesterday?
Assistant: The OPTIONS preflight request is not reaching your auth handler. When you added the CORS middleware after your auth middleware, preflight requests get rejected before CORS headers are set. Move cors() to before your auth middleware in the Express app.
User: What version of the cors package should I use?
Assistant: Use cors@2.8.5 — it is the last version with full Express 4 support and has no breaking changes from 2.x.