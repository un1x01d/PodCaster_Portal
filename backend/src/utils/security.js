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

/**
 * Generates a strong, random password.
 * @param {number} length - The desired length of the password.
 * @returns {string} - A randomly generated password.
 */
export function generateComplexPassword(length = 16) {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const symbols = "!@#$%^&*()-_+=[]{}|;:,.<>?";
    const allChars = uppercase + lowercase + numbers + symbols;

    let password = "";
    // Ensure at least one of each type
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    // Fill the rest of the length
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Shuffle the password to ensure randomness of character positions
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

