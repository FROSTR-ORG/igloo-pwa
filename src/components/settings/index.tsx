import { GroupConfigField }  from './group.js'
import { PeerConfigField }   from './peers.js'
import { RelayConfigField }  from './relays.js'
import { ResetStoreField }   from './reset.js'
import { ShareConfigField }  from './share.js'

export function SettingsView () {
  return (
    <>
      <GroupConfigField       />
      <ShareConfigField       />
      <PeerConfigField        />
      <RelayConfigField       />
      <ResetStoreField        />
    </>
  )
}
