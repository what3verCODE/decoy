import { useGate } from 'effector-react'
import type { JSX } from 'preact'
import { PageGate } from '../model'
import { Dashboard } from './dashboard'
import { TopBar } from './top-bar'

export function App(): JSX.Element {
  useGate(PageGate)

  return (
    <div class="h-full flex flex-col bg-background text-foreground">
      <TopBar />
      <Dashboard />
    </div>
  )
}
