import { statusBar } from '../data/dashboard'

/**
 * Two mutually exclusive treatments, chosen in CSS:
 *
 * - inside the desktop bezel, the simulated handset status bar the design drew;
 * - on a real phone, a spacer painted behind the device's own status bar, since
 *   showing a fake clock directly beneath the real one looks like a bug.
 */
export default function StatusBar() {
  return (
    <>
      <div className="ld-safe-top" aria-hidden="true" />
      <div className="ld-statusbar" aria-hidden="true">
        <span>{statusBar.time}</span>
        <span className="ld-statusbar__indicators">
          {statusBar.indicators.map((i) => (
            <span key={i}>{i}</span>
          ))}
        </span>
      </div>
    </>
  )
}
