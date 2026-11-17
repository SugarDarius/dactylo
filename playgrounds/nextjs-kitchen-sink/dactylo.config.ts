declare global {
  interface DactyloTypes {
    ParagraphBlockMetadata: {
      fontSize: string
    }

    MentionNodeEntityData: {
      email: string
      fullName: string
      role: string
    }
  }
}

// oxlint-disable-next-line unicorn/require-module-specifiers
export {}
