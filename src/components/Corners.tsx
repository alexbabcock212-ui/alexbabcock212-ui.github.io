/**
 * The design system's blueprint registration marks, drawn as four glyphs.
 *
 * `inset` tucks them inside a filled panel; `outset` hangs them off the
 * corners of a bordered card.
 */
export default function Corners({ variant }: { variant: 'inset' | 'outset' }) {
  return (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => (
        <i key={pos} aria-hidden="true" className={`ld-corner ld-corner--${variant} ld-corner--${pos}`}>
          +
        </i>
      ))}
    </>
  )
}
