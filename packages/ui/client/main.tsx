import './index.css'
import { render } from 'preact'
import { App, loadRoutes, startLogStream } from './App'

const root = document.getElementById('root')
if (root) {
  render(<App />, root)
  void loadRoutes()
  startLogStream()
}
