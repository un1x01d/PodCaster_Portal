import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
});
async function run() {
  await client.connect();
  const queries = [
    "SELECT substring('26520-01-01' from '[-+]?[0-9,]*\\.?\\d+') as val1",
    "SELECT substring('$ 1,200.50-01-01' from '[-+]?[0-9,]*\\.?\\d+') as val2",
    "SELECT substring('Text' from '[-+]?[0-9,]*\\.?\\d+') as val3",
    "SELECT substring('123.45' from '[-+]?[0-9,]*\\.?\\d+') as val4",
  ];
  for (const q of queries) {
    const res = await client.query(q);
    console.log(q, '->', res.rows[0]);
  }
  await client.end();
}
run();
