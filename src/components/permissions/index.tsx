import { useEffect, useState } from 'react'
// TODO: PWA storage update
// import { PermStore }           from '@/stores/perms.js'

import SignerPermissions  from './signer.js'

export default function Permissions() {
  // TODO: PWA storage update
  // const [ store, setStore ] = useState<PermStore.Type>(PermStore.DEFAULT)

  useEffect(() => {
    // TODO: PWA storage update
    // PermStore.fetch().then(store => setStore(store))
    // const unsub = PermStore.subscribe(store => setStore(store))
    // return () => unsub()
  }, [])

  return (
    <>
      {/* <SignerPermissions store={store} /> */}
    </>
  )
}
