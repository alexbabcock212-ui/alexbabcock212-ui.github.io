import { useEffect, useState } from 'react'
import { clock } from '../data/dashboard'

/**
 * Two mutually exclusive treatments, chosen in CSS:
 *
 * - inside the desktop bezel, a simulated handset status bar showing the real
 *   time (there is no way to read signal or battery, so neither is shown);
 * - on a real phone, a spacer painted behind the device's own status bar.
 */
export default function StatusBar() {
  const [time, setTime] = useState(clock)

  useEffect(() => {
    const id = setInterval(() => setTime(clock()), 15_000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <div className="ld-safe-top" aria-hidden="true" />
      <div className="ld-statusbar" aria-hidden="true">
        <span>{time}</span>
      </div>
    </>
  )
}
