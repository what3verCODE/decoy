import './index.css'
import { render } from 'preact'
import { App, loadRoutes } from './App'

const root = document.getElementById('root')
if (root) {
  render(<App />, root)
  void loadRoutes()
}
