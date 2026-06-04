import { useState } from "react";
import { authenticateLicense } from "../../../shared/api/auth";

interface AuthScreenProps {
  onAuthenticated: (licenseKey: string) => void;
}

/**
 * AuthScreen — Full-screen license key entry
 *
 * Shown when no valid license key is found in chrome.storage.local.
 * Validates the key via Supabase Edge Function and initializes a session.
 */
export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [key, setKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmed = key.trim();
    if (!trimmed) {
      setError("Введите лицензионный ключ");
      return;
    }

    if (trimmed.length < 8) {
      setError("Ключ слишком короткий");
      return;
    }

    setIsLoading(true);

    try {
      await authenticateLicense(trimmed);
      onAuthenticated(trimmed);
    } catch (err: any) {
      setError(err.message || "Не удалось проверить ключ. Попробуйте снова.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
      {/* Ambient glow behind the card */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-5">
            <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            TopicHunter
          </h1>
          <p className="text-sm text-text-secondary mt-1.5">
            Подбор тем для Adobe Stock
          </p>
          <div className="inline-block mt-3 px-3 py-1 rounded-full bg-accent/10 border border-accent/20">
            <span className="text-xs font-medium text-accent">StockBooster Extension</span>
          </div>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-bg-card border border-border rounded-2xl p-6 shadow-2xl shadow-black/40"
        >
          <label
            htmlFor="license-key"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            Лицензионный ключ
          </label>

          <input
            id="license-key"
            type="text"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (error) setError("");
            }}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className={`
              w-full px-4 py-3 rounded-xl
              bg-bg-input border text-text-primary text-sm
              placeholder:text-text-muted
              transition-all duration-200
              focus-ring
              ${error ? "border-error" : "border-border hover:border-border-hover focus:border-accent"}
            `}
          />

          {error && (
            <p className="mt-2 text-xs text-error flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading || !key.trim()}
            className={`
              w-full mt-4 px-4 py-3 rounded-xl
              text-sm font-semibold text-white
              transition-all duration-200
              focus-ring cursor-pointer
              ${
                isLoading || !key.trim()
                  ? "bg-accent/30 cursor-not-allowed"
                  : "bg-accent hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/20"
              }
            `}
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Проверка…
              </span>
            ) : (
              "Войти"
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-text-muted mt-5">
          Ключ доступен на{" "}
          <span className="text-accent">stockbooster.pro</span>
          {" "}→ Личный кабинет
        </p>
      </div>
    </div>
  );
}
