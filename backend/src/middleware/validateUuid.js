/**
 * validateUuid.js
 *
 * All primary keys in this app are UUIDs. When a route receives a malformed id
 * (e.g. "1"), Postgres throws `invalid input syntax for type uuid`, which would
 * otherwise surface to the client as a 500. This guard rejects bad ids up front
 * with a clean 404, so the DB never sees an invalid uuid.
 *
 * Usage:  router.param("id", uuidParam("Invoice"));
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidParam =
  (resource = "Resource") =>
  (req, res, next, value) => {
    if (!UUID_RE.test(value)) {
      return res.status(404).json({ error: `${resource} not found` });
    }
    next();
  };
