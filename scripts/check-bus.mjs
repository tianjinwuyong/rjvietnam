// Quick check: show recent bus messages
import pg from "pg";
const pool = new pg.Pool({ database: "smt_factory", user: "postgres", password: "postgres" });
const r = await pool.query(`
  SELECT source_agent, target_agent, subject, created_at
  FROM inter_agent_messages
  WHERE message_id LIKE 'sim-%' AND created_at >= NOW() - INTERVAL '60 seconds'
  ORDER BY created_at DESC LIMIT 10
`);
console.table(r.rows);
console.log(`Total sim messages ever:`, (await pool.query(`SELECT count(*) FROM inter_agent_messages WHERE message_id LIKE 'sim-%'`)).rows[0].count);
await pool.end();
