import { decode_group_pkg } from '@frostr/bifrost/encoder'
import { useEffect }        from 'react'

import { Header }      from '@/components/layout/header.js'
import { Tabs }        from '@/components/layout/tabs.js'
import { useSettings } from '@/hooks/useSettings.js'

import type { AppSettings } from '@/types/index.js'

export function App () {

  const store = useSettings()

  useEffect(() => {
    try {
      // Get the current settings.
      const { group, pubkey, share, relays } = store.data
      // Define the updated settings object.
      const updated : Partial<AppSettings> = {}
      // Parse the URL parameters for relay URLs.
      const params = new URLSearchParams(window.location.search)
      // Get the group parameter from the URL.
      const group_str  = params.get('g')
      // Get the pubkey parameter from the URL.
      const pubkey_str = params.get('p')
      // Get the share parameter from the URL.
      const share_str  = params.get('s')
      // Get all the relay URLs from the URL parameters.
      const urls = params.getAll('r')
      // For each relay URL,
      for (const url of urls) {
        // If the relay URL is not already in the list, add it.
        if (!relays.some(relay => relay.url === url)) {
          // If the relay array is not set,
          if (updated.relays === undefined) {
            // Create a new array.
            updated.relays = new Array()
          }
          // Add the relay to the array.
          updated.relays.push({ url, read: true, write: true })
        }
      }
      // If a group is specified, but the group is not set,
      if (group === null && group_str !== null) {
        // Set the group package from the URL parameter.
        updated.group = decode_group_pkg(group_str)
      }
      // If a share is specified, but the share is not set,
      if (
        share  === null && share_str  !== null &&
        pubkey === null && pubkey_str !== null
      ) {
        // Set the share from the URL parameter.
        updated.pubkey = pubkey_str
        updated.share  = share_str
      }
      // If the updated settings object is not empty,
      if (Object.keys(updated).length > 0) {
        // Update the store.
        store.update(updated)
      }
    } catch (e) {
      console.error(e)
    }
  }, [])

  return (
    <div className="app">
      <Header />
      <Tabs />
    </div>
  )
}
