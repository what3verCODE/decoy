import './index.css'
import { render } from 'preact'
import { App } from './ui/app'

const root = document.getElementById('root')
if (root) {
  render(<App />, root)
}
