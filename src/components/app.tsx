import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Header } from '@/components/layout/header.js'
import { Tabs }   from '@/components/layout/tabs.js'

// Create a client instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

export function App () {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app">
        <Header />
        <Tabs />
      </div>
    </QueryClientProvider>
  )
}
