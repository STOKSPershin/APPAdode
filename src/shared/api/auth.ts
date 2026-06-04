import { encryptValue, decryptValue, isEncrypted } from '../../utils/crypto';
import { generateChecksum } from '../../utils/integrity';
import { getSupabase } from './supabase';

export async function setSecureLicense(licenseKey: string) {
  try {
    const encrypted = await encryptValue(licenseKey);
    const checksum = generateChecksum(licenseKey);
    await chrome.storage.local.set({
      licenseKeyEncrypted: encrypted,
      authChecksum: checksum,
      isAuthenticated: true,
      lastValidation: Date.now()
    });
    // For backward compatibility / easy access in the app
    await chrome.storage.local.set({ licenseKey });
  } catch (err) {
    console.error('Encryption failed', err);
    await chrome.storage.local.set({ licenseKey, isAuthenticated: true, lastValidation: Date.now() });
  }
}

export async function getSecureLicense(): Promise<{ valid: boolean; licenseKey?: string }> {
  // If we are outside of chrome extension environment (e.g. testing), fallback to localStorage
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    const licenseKey = localStorage.getItem('licenseKey');
    if (licenseKey) return { valid: true, licenseKey };
    return { valid: false };
  }

  const data = await chrome.storage.local.get(['licenseKey', 'licenseKeyEncrypted', 'authChecksum', 'isAuthenticated']);
  if (!data.isAuthenticated) {
      // Fallback check if simple licenseKey is there (from previous version)
      if (data.licenseKey) {
          return { valid: true, licenseKey: data.licenseKey };
      }
      return { valid: false };
  }

  if (data.licenseKey && data.authChecksum) {
    if (generateChecksum(data.licenseKey) === data.authChecksum) {
      return { valid: true, licenseKey: data.licenseKey };
    }
  }

  if (data.licenseKeyEncrypted && isEncrypted(data.licenseKeyEncrypted)) {
    try {
      const decrypted = await decryptValue(data.licenseKeyEncrypted);
      if (decrypted && decrypted.length > 5) {
        return { valid: true, licenseKey: decrypted };
      }
    } catch {}
  }
  return { valid: false };
}

export async function authenticateLicense(licenseKey: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke('exchange-license', {
    body: { license_key: licenseKey }
  });

  if (error || !data || data.error) {
    throw new Error(data?.error || error?.message || 'Invalid license key');
  }

  if (data.access_token) {
    await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.access_token,
    });
    await setSecureLicense(licenseKey);
    return true;
  }
  
  throw new Error("Invalid response from auth server");
}

export async function checkAndRevalidateSession() {
  const { valid, licenseKey } = await getSecureLicense();
  if (!valid || !licenseKey) return false;

  let lastValidation = 0;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await chrome.storage.local.get('lastValidation');
    lastValidation = data.lastValidation || 0;
  }

  const TEN_MINUTES = 10 * 60 * 1000;
  const { data: sessionData } = await getSupabase().auth.getSession();
  
  if ((Date.now() - lastValidation > TEN_MINUTES) || !sessionData.session) {
    try {
      await authenticateLicense(licenseKey);
    } catch (e) {
      console.error('Revalidation failed', e);
      await logout();
      return false;
    }
  }
  return true;
}

export async function logout() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.remove(['licenseKey', 'licenseKeyEncrypted', 'authChecksum', 'isAuthenticated', 'lastValidation']);
  } else {
    localStorage.removeItem('licenseKey');
  }
  await getSupabase().auth.signOut();
}
