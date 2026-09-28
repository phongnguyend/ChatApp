export const MAX_MESSAGE_ATTACHMENTS = 5
export const MAX_MESSAGE_ATTACHMENT_SIZE = 15 * 1024 * 1024

export function appendMessageAttachments(existing: File[], selected: File[]): File[] {
  const names = new Set(existing.map((file) => file.name.toLowerCase()))
  const additions = selected.map((file) => {
    const extensionIndex = file.name.lastIndexOf('.')
    const stem = extensionIndex > 0 ? file.name.slice(0, extensionIndex) : file.name
    const extension = extensionIndex > 0 ? file.name.slice(extensionIndex) : ''
    let name = file.name
    let suffix = 2
    while (names.has(name.toLowerCase())) {
      name = `${stem} (${suffix++})${extension}`
    }
    names.add(name.toLowerCase())
    return name === file.name
      ? file
      : new File([file], name, { type: file.type, lastModified: file.lastModified })
  })
  return [...existing, ...additions]
}

export function validateMessageAttachments(existing: File[], selected: File[]): string | null {
  if (existing.length + selected.length > MAX_MESSAGE_ATTACHMENTS) {
    return 'Add up to 5 attachments per message.'
  }

  const oversized = selected.find((file) => file.size > MAX_MESSAGE_ATTACHMENT_SIZE)
  if (oversized) {
    return `"${oversized.name}" is larger than 15 MB.`
  }

  return null
}
