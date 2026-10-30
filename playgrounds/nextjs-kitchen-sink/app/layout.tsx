import '~/app/globals.css'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { Toaster } from '~/components/ui/toast'
import { TooltipProvider } from '~/components/ui/tooltip'

import { ThemeProvider } from './theme-provider'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  description: 'A playground for Dactylo',
  title: 'Dactylo Next.js Kitchen Sink',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang='en'
      className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
      suppressHydrationWarning
    >
      <body className='relative min-h-screen'>
        <ThemeProvider
          enableSystem
          attribute='class'
          defaultTheme='system'
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
