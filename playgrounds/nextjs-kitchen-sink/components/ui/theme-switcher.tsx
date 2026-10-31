'use client'

import { SunIcon, MoonIcon } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

export function ThemeSwitcher({
  className,
  ...props
}: React.ComponentProps<'button'>) {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant='ghost'
      size='icon'
      {...props}
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      className={cn(
        'relative',
        '[&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:inset-0 [&_svg]:m-auto',
        '[&_svg]:transition-[opacity,transform] [&_svg]:duration-300 [&_svg]:ease-in-out',
        className,
      )}
    >
      <SunIcon className='size-3.5 scale-100 opacity-100 dark:pointer-events-none dark:scale-90 dark:opacity-0' />
      <MoonIcon className='pointer-events-none size-3.5 scale-90 opacity-0 dark:pointer-events-auto dark:scale-100 dark:opacity-100' />
    </Button>
  )
}
