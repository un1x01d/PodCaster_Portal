import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://portal:portalpass@localhost:5432/portaldb'
});

async function debug() {
    try {
        console.log('--- USERS ---');
        const users = await pool.query('SELECT id, email, role FROM users');
        console.table(users.rows);

        console.log('\n--- SHEETS ---');
        const sheets = await pool.query('SELECT id, filename, folder_id, active FROM sheets');
        console.table(sheets.rows);

        console.log('\n--- GROUPS ---');
        const groups = await pool.query('SELECT * FROM groups');
        console.table(groups.rows);

        console.log('\n--- USER GROUPS ---');
        const userGroups = await pool.query('SELECT * FROM user_groups');
        console.table(userGroups.rows);

        console.log('\n--- GROUP PERMISSIONS ---');
        const perms = await pool.query('SELECT * FROM group_permissions');
        console.table(perms.rows);

        console.log('\n--- SIMULATED /my-files QUERY (User 40) ---');
        const myFilesQuery = `
        SELECT DISTINCT s.id, s.filename, s.uploaded_at, f.name AS folder_name
        FROM sheets s
        LEFT JOIN folders f ON f.id = s.folder_id
        WHERE s.id IN (
          SELECT gp.sheet_id
          FROM group_permissions gp
          WHERE gp.group_id IN (
            SELECT ug.group_id
            FROM user_groups ug
            WHERE ug.user_id = $1
          )
        )
        ORDER BY s.uploaded_at DESC
        LIMIT 50`;
        const res = await pool.query(myFilesQuery, [40]);
        console.table(res.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

debug();
