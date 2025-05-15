import { useEffect, useState } from 'react'
import { SettingStore }        from '@/types/settings.js'

import GeneralSettings     from './general.js'
import NodeSettings        from './node.js'
// import TransactionSettings from './transaction.js'
// import LinkSettings        from './links.js'
import DevSettings         from './dev.js'

export default function Settings() {
  const [ store, setStore ] = useState<SettingStore.Type>(SettingStore.DEFAULT)

  useEffect(() => {
    // TODO: PWA storage update
    // SettingStore.fetch().then(store => setStore(store))
    // const unsub = SettingStore.subscribe(store => setStore(store))
    // return () => unsub()
  }, [])

  return (
    <div className="container">
      <GeneralSettings store={store} />
      <NodeSettings store={store}    />
      <DevSettings />
    </div>
  )
}
