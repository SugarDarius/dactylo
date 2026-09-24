import { Editor } from '~/components/dactylo/editor'

export default function Page() {
  return (
    <div className='relative flex w-full flex-col items-center gap-4 p-4'>
      <h1 className='text-2xl font-bold tracking-wide'>
        Dactylo kitchen sink (Next.js)
      </h1>
      <Editor />
    </div>
  )
}
