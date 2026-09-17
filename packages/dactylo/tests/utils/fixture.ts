import { Dactylo } from '../../src/dactylo'
import { createParagraphBlock } from '../../src/internals/blocks'
import type { Block, BlockId } from '../../src/internals/blocks'
import type { InsertBlockOp } from '../../src/internals/operations'
import { makeInitialPosition } from '../../src/internals/position'
import type { PosKey } from '../../src/internals/position'
import type { Metadata } from '../../src/internals/types'

/** Fixture API to use in tests. */
export interface FixtureApi {
  /** Dactylo instance. */
  readonly dactylo: Dactylo

  /** Blocks fixture API. */
  readonly blocks: {
    /** Creates an empty paragraph block. */
    createEmptyParagraphBlock: (opts?: {
      metadata?: Metadata
      posKey?: PosKey
    }) => Block
  }

  /** Operations fixture API. */
  readonly operations: {
    /** Creates an insert block operation. */
    createInsertBlockOperation: (opts: {
      block: Block
      afterBlockId?: BlockId | null
    }) => InsertBlockOp
  }
}

export function makeFixtureSetupApi(
  options: { placeholder?: string } = {},
): FixtureApi {
  const { placeholder = 'Write something…' } = options
  const dactylo = new Dactylo({ placeholder })

  return {
    blocks: {
      createEmptyParagraphBlock: (opts?: {
        metadata?: Metadata
        posKey?: PosKey
      }) =>
        createParagraphBlock({
          content: [],
          metadata: opts?.metadata ?? {},
          parentId: null,
          posKey: opts?.posKey ?? makeInitialPosition(),
        }),
    },
    dactylo,
    operations: {
      createInsertBlockOperation: (opts: {
        block: Block
        afterBlockId?: BlockId | null
      }): InsertBlockOp => ({
        __type: 'insert_block',
        afterBlockId: opts.afterBlockId ?? null,
        block: opts.block,
      }),
    },
  }
}
