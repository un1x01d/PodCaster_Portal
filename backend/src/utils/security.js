import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

/**
 * Hash a password using bcrypt.
 * @param {string} password - The plain text password.
 * @returns {Promise<string>} - The hashed password.
 */
export async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash.
 * Implements "lazy migration": if the stored password is NOT a bcrypt hash,
 * it treats it as plaintext, compares, and returns 'needs_rehash' if valid.
 * 
 * @param {string} password - The plain text password from login.
 * @param {string} storedPassword - The password string stored in DB (hash or plain).
 * @returns {Promise<{ valid: boolean, rehash: boolean }>} 
 */
export async function verifyPassword(password, storedPassword) {
    if (!storedPassword) return { valid: false, rehash: false };

    // Check if stored password looks like a bcrypt hash
    const isBcrypt = storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2a$");

    if (isBcrypt) {
        const valid = await bcrypt.compare(password, storedPassword);
        return { valid, rehash: false };
    } else {
        // Plaintext fallback (Lazy Migration)
        if (password === storedPassword) {
            return { valid: true, rehash: true };
        }
        return { valid: false, rehash: false };
    }
}
