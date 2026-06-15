import './index.css'
import { render } from 'preact'
import { startApp } from './model/init'
import { App } from './ui/app'

const root = document.getElementById('root')
if (root) {
  render(<App />, root)
  startApp()
}
