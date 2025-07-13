// Shared types for request cards
import type { PermissionRequest } from '@cmdcode/nostr-connect'

export interface SessionOrigin {
  name?: string
  image?: string
  pubkey: string
  url?: string
}

export interface BaseCardProps {
  request: PermissionRequest
  isExpanded: boolean
}

export interface NoteSignatureCardProps extends BaseCardProps {
  // Inherits from BaseCardProps
} 