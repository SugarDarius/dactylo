'use client'

import {
  Composer,
  // useCommandsListener,
  // useToolsListener,
} from '@sugardarius/dactylo/react'

import { cn } from '~/lib/utils'

// function CommandsListener() {
//   useCommandsListener(({ command, status }) => {
//     console.log('Command', { command, status })
//   })
//   return null
// }

// function ToolsListener() {
//   useToolsListener(({ tool, status }) => {
//     console.log('Tool', { status, tool })
//   })
//   return null
// }

export function Editor({ className, ...props }: React.ComponentProps<'div'>) {
  const debug = process.env.NODE_ENV === 'development'
  return (
    <div className={cn('relative w-full', className)} {...props}>
      <Composer.Root
        placeholder='Write something…'
        clientOnly={true}
        debug={debug}
        className='relative w-full'
      >
        <Composer.Editable autoFocus className='relative w-full' />
        {/* <ToolsListener /> */}
        {/* <CommandsListener /> */}
      </Composer.Root>
    </div>
  )
}
