// A deliberately tiny SPA: two buttons fire real `fetch`es at the fake users API
// and render the outcome into the DOM, so a Playwright test can assert on what the
// user would see. Every `/api/*` request is intercepted by the router (no server).

function el(testId: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!node) throw new Error(`missing element: ${testId}`)
  return node
}

async function call(path: string): Promise<void> {
  const status = el('status')
  const miss = el('miss')
  const body = el('body')
  status.textContent = '…'
  miss.textContent = ''
  body.textContent = ''

  const res = await fetch(path)
  status.textContent = String(res.status)
  miss.textContent = res.headers.get('x-mock-miss') ?? ''
  body.textContent = await res.text()
}

el('load-user').addEventListener('click', () => {
  void call('/api/users/42')
})
el('load-missing').addEventListener('click', () => {
  void call('/api/unmocked')
})
