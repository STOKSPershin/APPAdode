/**
 * AES-GCM Encryption Module
 * Ported from Midjourney Auto extension
 * 
 * Provides secure storage for license keys using:
 * - PBKDF2 for key derivation
 * - AES-GCM for encryption/decryption
 */

const ENCRYPTION_CONFIG = {
    keyLength: 256,
    ivLength: 12,
    saltLength: 16,
    iterations: 100000,
    tagLength: 128,
};

// Device-bound passphrase components
function getPassphrase(): string {
    const components = [
        'IQ_TOOLS_2026',
        navigator.userAgent.slice(0, 32),
        navigator.language,
        screen.colorDepth?.toString() || '24',
    ];
    return components.join('|');
}

/**
 * Derives an AES key from a passphrase using PBKDF2
 */
async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
    const passphrase = getPassphrase();
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as unknown as BufferSource,
            iterations: ENCRYPTION_CONFIG.iterations,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: ENCRYPTION_CONFIG.keyLength },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts a string value using AES-GCM
 * Returns a base64-encoded string containing: salt + iv + ciphertext
 */
export async function encryptValue(plaintext: string): Promise<string> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(ENCRYPTION_CONFIG.saltLength));
    const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_CONFIG.ivLength));
    const key = await deriveKey(salt);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: ENCRYPTION_CONFIG.tagLength },
        key,
        encoder.encode(plaintext)
    );

    // Combine salt + iv + ciphertext into single buffer
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

    return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a base64-encoded AES-GCM ciphertext
 */
export async function decryptValue(encoded: string): Promise<string> {
    const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));

    const salt = combined.slice(0, ENCRYPTION_CONFIG.saltLength);
    const iv = combined.slice(
        ENCRYPTION_CONFIG.saltLength,
        ENCRYPTION_CONFIG.saltLength + ENCRYPTION_CONFIG.ivLength
    );
    const ciphertext = combined.slice(
        ENCRYPTION_CONFIG.saltLength + ENCRYPTION_CONFIG.ivLength
    );

    const key = await deriveKey(salt);

    const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: ENCRYPTION_CONFIG.tagLength },
        key,
        ciphertext
    );

    return new TextDecoder().decode(plainBuffer);
}

/**
 * Quick check if a value looks like our encrypted format
 */
export function isEncrypted(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
        const decoded = atob(value);
        return decoded.length > ENCRYPTION_CONFIG.saltLength + ENCRYPTION_CONFIG.ivLength + 16;
    } catch {
        return false;
    }
}
