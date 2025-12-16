import { query } from "../config/db.js";
import { hashPassword, verifyPassword } from "../utils/security.js";
import { generateToken } from "../middleware/auth.js";

export async function login(req, res) {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing credentials" });

    const rows = await query("SELECT * FROM users WHERE email=$1", [email]);
    if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];
    const { valid, rehash } = await verifyPassword(password, user.password);

    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    if (rehash) {
        // Lazy migration: Update to hashed password
        console.log(`[Auth] Migrating password for user ${user.id} to bcrypt hash.`);
        const newHash = await hashPassword(password);
        await query("UPDATE users SET password = $1 WHERE id = $2", [newHash, user.id]);
    }

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
}

export async function getMe(req, res) {
    const rows = await query(
        "SELECT id, email, role, default_view_id FROM users WHERE id = $1",
        [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "user_not_found" });
    res.json(rows[0]);
}
