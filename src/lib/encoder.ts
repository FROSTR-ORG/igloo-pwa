import { PackageEncoder as Encoder } from '@frostr/bifrost'

export function decode_share (share_str : string) {
  // Try to decode the package:
  try {
    // Return the decoded share package.
    return Encoder.share.decode(share_str)
  } catch (err) {
    // Print error to console.
    console.error(err)
    // Return null value.
    return null
  }
}
