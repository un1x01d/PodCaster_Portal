import bcrypt from "bcrypt";
import { randomInt } from "crypto";

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
 * 
 * @param {string} password - The plain text password from login.
 * @param {string} storedPassword - The bcrypt hash stored in DB.
 * @returns {Promise<{ valid: boolean, rehash: boolean }>} 
 */
export async function verifyPassword(password, storedPassword) {
    if (!storedPassword) return { valid: false, rehash: false };

    // Check if stored password looks like a bcrypt hash
    const isBcrypt = storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2a$");

    if (isBcrypt) {
        const valid = await bcrypt.compare(password, storedPassword);
        return { valid, rehash: false };
    }

    // Explicit opt-in fallback for legacy plaintext rows to support controlled migrations.
    const allowLegacyPlaintext = String(process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS || "").toLowerCase() === "true";
    if (allowLegacyPlaintext && String(password) === String(storedPassword)) {
        return { valid: true, rehash: true };
    }

    return { valid: false, rehash: false };
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
    // Ensure at least one of each type — use randomInt for CSPRNG
    password += uppercase[randomInt(uppercase.length)];
    password += lowercase[randomInt(lowercase.length)];
    password += numbers[randomInt(numbers.length)];
    password += symbols[randomInt(symbols.length)];

    // Fill the rest of the length
    for (let i = password.length; i < length; i++) {
        password += allChars[randomInt(allChars.length)];
    }

    // Fisher-Yates shuffle using randomInt (no bias)
    const arr = password.split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
}
