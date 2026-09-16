import type { ReactNode } from 'react'

export const metadata = {
  title: 'ConfiDentist',
  description: 'ConfiDentist dental exam preparation.',
}

// Root layout — applies to the new Next.js (dynamic) routes only.
// The existing marketing pages are served as static HTML from /public
// and are unaffected by this layout.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
