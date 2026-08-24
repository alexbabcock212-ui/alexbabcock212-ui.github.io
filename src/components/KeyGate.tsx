import { useState } from 'react'
import type { FormEvent } from 'react'
import Corners from './Corners'
import { API_BASE, isConfigured } from '../data/api'

interface Props {
  onInstall: (key: string) => void
  onClose: () => void
  /** Shown when a key was present but the service rejected it. */
  rejected: boolean
}

/**
 * The one place a human is ever asked for anything.
 *
 * Normally this is never seen: the key arrives in the URL fragment the first
 * time the site is opened from the setup link, and is kept from then on. It
 * exists for the cases that link cannot cover — a new device, a cleared Safari,
 * a rotated token.
 */
/** The service host, for the fine print. Never throws on a malformed base. */
function apiHost(): string {
  try {
    return new URL(API_BASE).host
  } catch {
    return API_BASE
  }
}

export default function KeyGate({ onInstall, onClose, rejected }: Props) {
  const [value, setValue] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) onInstall(value)
  }

  return (
    <div className="ld-sheet" role="dialog" aria-modal="true" aria-labelledby="ld-sheet-title">
      <div className="ld-sheet__panel">
        <Corners variant="outset" />
        <div className="ld-sheet__kicker">DEVICE KEY</div>
        <h2 className="ld-sheet__title" id="ld-sheet-title">
          {rejected ? 'This key was refused' : 'Set up this device'}
        </h2>
        <p className="ld-sheet__note">
          {isConfigured() ? (
            rejected ? (
              <>
                The key this device holds was turned down. It was probably rotated — run{' '}
                <code>npm run setup</code> on your Mac and install the new one.
              </>
            ) : (
              <>
                Paste the dashboard key, or open this site once with <code>#key=…</code> on the end
                of the URL. Either way it is stored here and never asked for again — there is no
                Google sign-in in this app.
              </>
            )
          ) : (
            <>
              This build has no service address. Set <code>VITE_API_BASE</code> in <code>.env</code>{' '}
              and deploy again.
            </>
          )}
        </p>

        {isConfigured() && (
          <form onSubmit={submit}>
            <input
              className="ld-sheet__input"
              type="password"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Dashboard key"
              aria-label="Dashboard key"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="ld-sheet__actions">
              <button type="button" className="ld-sheet__cancel" onClick={onClose}>
                CANCEL
              </button>
              <button type="submit" className="ld-connect" disabled={!value.trim()}>
                SAVE KEY
              </button>
            </div>
          </form>
        )}

        {isConfigured() && (
          <p className="ld-sheet__fine">
            Reads from <code>{apiHost()}</code>
          </p>
        )}
      </div>
    </div>
  )
}
