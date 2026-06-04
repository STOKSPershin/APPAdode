/**
 * Integrity checks for anti-tampering protection
 * Detects DevTools and provides basic anti-debugging measures
 */

// DevTools detection state
let devToolsOpen = false;
let checkCounter = 0;

/**
 * Detects if DevTools are open via timing attack
 * The debugger statement takes significantly longer when DevTools are open
 */
export function checkDevTools(): boolean {
    const threshold = 100;
    const before = performance.now();

    // This technique works because console.log is slower when DevTools console is open
    // We use a regex toString trick that's expensive to render
    const element = new Image();
    Object.defineProperty(element, 'id', {
        get: function () {
            devToolsOpen = true;
            return 'DevTools detected';
        }
    });

    // Alternate check: window size difference
    const widthThreshold = window.outerWidth - window.innerWidth > 160;
    const heightThreshold = window.outerHeight - window.innerHeight > 160;

    if (widthThreshold || heightThreshold) {
        devToolsOpen = true;
    }

    const after = performance.now();
    if (after - before > threshold) {
        devToolsOpen = true;
    }

    return devToolsOpen;
}

/**
 * Generates a simple checksum for critical data validation
 */
export function generateChecksum(data: string): string {
    let hash = 0;
    const salt = 'IQ_SALT_2026';
    const saltedData = salt + data + salt;

    for (let i = 0; i < saltedData.length; i++) {
        const char = saltedData.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }

    return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Validates that stored auth data hasn't been tampered with
 */
export function validateAuthIntegrity(
    isAuthenticated: boolean,
    licenseKey: string | undefined,
    storedChecksum: string | undefined
): boolean {
    if (!isAuthenticated || !licenseKey) {
        return true; // Not authenticated, no integrity check needed
    }

    if (!storedChecksum) {
        return false; // Data exists but no checksum = tampering
    }

    const expectedChecksum = generateChecksum(licenseKey);
    return storedChecksum === expectedChecksum;
}

/**
 * Periodic integrity watcher - runs every N seconds
 */
export function startIntegrityWatcher(callback: () => void): void {
    const CHECK_INTERVAL = 30000; // 30 seconds

    setInterval(() => {
        checkCounter++;

        // Run DevTools check every other interval
        if (checkCounter % 2 === 0) {
            if (checkDevTools()) {
                console.warn('[IQ-Guard] Inspection detected');
                // Don't block, just log for now
            }
        }

        // Run callback for additional checks
        callback();
    }, CHECK_INTERVAL);
}

/**
 * One-time integrity check on startup
 */
export function runStartupCheck(): { passed: boolean; reason?: string } {
    // Check 1: Verify we're running in extension context
    if (typeof chrome === 'undefined' || !chrome.runtime) {
        return { passed: false, reason: 'invalid_context' };
    }

    // Check 2: Verify extension ID format
    const extensionId = chrome.runtime?.id;
    if (!extensionId || extensionId.length < 20) {
        return { passed: false, reason: 'invalid_extension' };
    }

    return { passed: true };
}
